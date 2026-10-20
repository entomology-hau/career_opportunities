import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, seal, unseal } from './worker.js';

// These boundary tests exercise the public Worker, with no external requests.
const ORIGIN = 'https://admin.example.test';
const REPOSITORY = 'entomology-hau/career_opportunities';
const TOKEN = 'ghu_test-only-token';
const CSRF = 'test-csrf-research-admin-value';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function fixture({ githubLogin = 'owner', push = true } = {}) {
  const dispatched = [], assets = [], githubCalls = [];
  const env = {
    REPOSITORY, REPOSITORY_ID: '1397618839', BRANCH: 'main', ALLOWED_GITHUB_LOGINS: 'owner',
    GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET: 'integration-test-session-secret-longer-than-thirty-two',
    PUBLIC_SITE_URL: 'https://entomology-hau.github.io/career_opportunities/',
    ASSETS: { async fetch(request) { assets.push(request.url); return new Response('public interface'); } },
    RESEARCH_LIBRARY: {
      idFromName: name => name,
      get: () => ({ async fetch(request) { dispatched.push(request); return json({ ok: true }); } }),
    },
  };
  const fetcher = async (url, init = {}) => {
    githubCalls.push(url);
    if (url === 'https://github.com/login/oauth/access_token') {
      return json({ access_token: TOKEN, token_type: 'bearer', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    if (url === 'https://api.github.com/user') return json({ login: githubLogin });
    if (url === `https://api.github.com/repos/${REPOSITORY}`) {
      return json({ id: 1397618839, full_name: REPOSITORY, permissions: { push } });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };
  return { env, fetcher, dispatched, assets, githubCalls };
}

async function adminCookie(env) {
  const now = Date.now();
  return `__Host-hau_admin=${await seal({ kind: 'session', token: TOKEN, login: 'owner', csrf: CSRF,
    iat: now, exp: now + 3600000 }, env, ORIGIN, 'session')}`;
}

test('research administration rejects absent, forged and student-only credentials before private dispatch', async () => {
  for (const headers of [{}, { Cookie: '__Host-hau_admin=forged' },
    { Cookie: '__Host-hau_research=student-session', 'X-Research-Admin': 'owner', 'X-Admin-Login': 'owner' }]) {
    const f = fixture();
    const response = await handle(new Request(`${ORIGIN}/research-api/admin/state`, { headers }), f.env, f.fetcher);
    assert.equal(response.status, 401);
    assert.equal(f.dispatched.length, 0);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('research admin mutations require same origin and the GitHub-session CSRF token', async () => {
  for (const patch of [{ Origin: 'https://evil.example' }, { Origin: null },
    { 'X-CSRF-Token': 'wrong' }, { 'X-CSRF-Token': null }]) {
    const f = fixture();
    const headers = { Cookie: await adminCookie(f.env), Origin: ORIGIN, 'X-CSRF-Token': CSRF,
      'Content-Type': 'application/json', ...patch };
    Object.keys(headers).forEach(key => { if (headers[key] === null) delete headers[key]; });
    const response = await handle(new Request(`${ORIGIN}/research-api/admin/users`, {
      method: 'POST', headers, body: JSON.stringify({ email: 'student@example.test' }),
    }), f.env, f.fetcher);
    assert.equal(response.status, 403);
    assert.equal(f.dispatched.length, 0);
  }
});

test('research admin identity and repository permission are revalidated on every request', async () => {
  for (const config of [{ githubLogin: 'another-user' }, { push: false }]) {
    const f = fixture(config);
    const response = await handle(new Request(`${ORIGIN}/research-api/admin/state`, {
      headers: { Cookie: await adminCookie(f.env) },
    }), f.env, f.fetcher);
    assert.equal(response.status, 403);
    assert.equal(f.dispatched.length, 0);
    assert.ok(f.githubCalls.includes('https://api.github.com/user'));
  }
});

test('only a verified GitHub admin reaches private administration storage', async () => {
  const f = fixture();
  const response = await handle(new Request(`${ORIGIN}/research-api/admin/state`, {
    headers: { Cookie: await adminCookie(f.env), 'X-Hau-Research-Admin': 'attacker',
      'X-Hau-Research-Origin': 'https://evil.example', 'X-Hau-Research-IP': 'forged' },
  }), f.env, f.fetcher);
  assert.equal(response.status, 200);
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].headers.get('X-Hau-Research-Admin'), 'owner');
  assert.equal(f.dispatched[0].headers.get('X-Hau-Research-Origin'), ORIGIN);
  assert.equal(f.dispatched[0].headers.get('X-Hau-Research-IP'), 'unknown');
  assert.deepEqual(f.githubCalls, ['https://api.github.com/user', `https://api.github.com/repos/${REPOSITORY}`]);
});

test('public research requests cannot smuggle an administrator identity to storage', async () => {
  const f = fixture();
  const response = await handle(new Request(`${ORIGIN}/research-api/session`, {
    headers: { 'X-Hau-Research-Admin': 'owner', 'X-Hau-Research-Origin': 'https://evil.example',
      'X-Hau-Research-IP': 'forged', 'CF-Connecting-IP': '192.0.2.3' },
  }), f.env, f.fetcher);
  assert.equal(response.status, 200); // The stub returns 200; a real DO requires a student session.
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].headers.get('X-Hau-Research-Admin'), null);
  assert.equal(f.dispatched[0].headers.get('X-Hau-Research-Origin'), ORIGIN);
  assert.equal(f.dispatched[0].headers.get('X-Hau-Research-IP'), '192.0.2.3');
  assert.equal(f.githubCalls.length, 0);
});

test('research interface assets use restrictive security headers; private filenames never fall through to static assets', async () => {
  const f = fixture();
  for (const path of ['/research.html', '/research-admin.html', '/research.js', '/research-admin.js', '/research.css']) {
    const response = await handle(new Request(ORIGIN + path), f.env, f.fetcher);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  }
  const assetCount = f.assets.length;
  for (const path of ['/research/private.pdf', '/documents/private.pdf', '/research-data.json', '/research-api']) {
    const response = await handle(new Request(ORIGIN + path), f.env, f.fetcher);
    assert.equal(response.status, 404);
  }
  assert.equal(f.assets.length, assetCount);
});

test('OAuth return destination permits the research admin page and rejects external or arbitrary paths', async () => {
  for (const destination of ['/research-admin.html', 'https://evil.example/', '//evil.example/',
    '/research-admin.html?next=https://evil.example/', '/research.html']) {
    const f = fixture();
    const response = await handle(new Request(`${ORIGIN}/auth/login?returnTo=${encodeURIComponent(destination)}`), f.env, f.fetcher);
    assert.equal(response.status, 303);
    const cookie = response.headers.getSetCookie().find(x => x.startsWith('__Host-hau_oauth='))?.split(';')[0];
    assert.ok(cookie);
    const value = cookie.slice('__Host-hau_oauth='.length);
    const state = await unseal(value, f.env, ORIGIN, 'oauth');
    const expected = destination === '/research-admin.html' ? destination : '/admin.html';
    assert.equal(state.returnTo, expected);
    const callback = await handle(new Request(`${ORIGIN}/auth/callback?code=mock-code&state=${state.state}&returnTo=https://evil.example/`,
      { headers: { Cookie: cookie } }), f.env, f.fetcher);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('Location'), ORIGIN + expected);
  }
});
