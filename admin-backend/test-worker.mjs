import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalAllowed, canonicalURL, fingerprint, handle, HttpError, saveDecision, seal, unseal } from './worker.js';

// Every request is injected: these tests must never contact GitHub or Cloudflare.
const ORIGIN = 'https://admin.example.test';
const REPOSITORY = 'entomology-hau/career_opportunities';
const REPO_URL = `https://api.github.com/repos/${REPOSITORY}`;
const QUEUE_URL = `${REPO_URL}/contents/data/review-queue.json`;
const SHA = 'a'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);
const TOKEN = 'ghu_secret-user-access-token';
const CSRF = 'random-csrf-test-value';
const SESSION_COOKIE = '__Host-hau_admin';
const OAUTH_COOKIE = '__Host-hau_oauth';
const NOW = Date.UTC(2026, 9, 1, 12);
const day = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

function environment(overrides = {}) {
  return {
    REPOSITORY, BRANCH: 'main', ALLOWED_GITHUB_LOGINS: 'owner, Second-Admin',
    GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET: 'client-secret-do-not-expose',
    SESSION_SECRET: 'session-secret-at-least-32-characters-do-not-expose',
    PUBLIC_SITE_URL: 'https://entomology-hau.github.io/career_opportunities/',
    ASSETS: { fetch: async () => new Response('public asset') },
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    url: 'https://jobs.example.test/advert/1?utm_source=feed',
    title: 'PhD: pollinator biodiversity — café 🐝', organisation: 'Université de Zürich',
    lastSeen: day(), reviewStatus: 'pending', reason: 'Uncertain funding',
    raw: { excerpt: 'Biological control in São Paulo', sourceId: 'primary-feed', tags: ['IPM', '生态学'] },
    ...overrides,
  };
}

function queue(candidates = [candidate()], overrides = {}) {
  return { version: 1, candidates, excluded: [], decisions: [], collectorMetadata: { keep: true }, ...overrides };
}

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

function githubMock(t, options = {}) {
  const calls = [], unexpected = [];
  const data = options.queue ?? queue();
  const fetcher = async (url, init = {}) => {
    const request = new Request(url, init);
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ url: request.url, method: request.method, headers: request.headers, body, redirect: init.redirect });
    const authenticated = request.headers.has('Authorization');
    if (authenticated) assert.equal(request.headers.get('Authorization'), `Bearer ${TOKEN}`);
    if (request.url === REPO_URL && request.method === 'GET') {
      return json(authenticated ? {
        full_name: options.fullName ?? REPOSITORY, permissions: { push: options.push ?? true },
      } : { id: 123456, full_name: REPOSITORY });
    }
    if (request.url === 'https://github.com/login/oauth/access_token' && request.method === 'POST') {
      return json(options.tokenResponse ?? { access_token: TOKEN, token_type: 'bearer', expires_in: 7200 });
    }
    if (request.url === 'https://api.github.com/user' && request.method === 'GET') {
      return json({ login: options.login ?? 'owner' });
    }
    if (request.url === `${QUEUE_URL}?ref=main` && request.method === 'GET') {
      assert.ok(authenticated, 'Reading the queue requires a user token');
      return json({ type: 'file', encoding: 'base64', sha: options.sha ?? SHA,
        content: Buffer.from(JSON.stringify(data), 'utf8').toString('base64').match(/.{1,60}/g).join('\n') });
    }
    if (request.url === QUEUE_URL && request.method === 'PUT') {
      assert.ok(authenticated, 'Saving the queue requires a user token');
      return json(options.putResponse ?? { commit: { sha: COMMIT_SHA } }, options.putStatus ?? 200);
    }
    unexpected.push(`${request.method} ${request.url}`);
    throw new Error(`Unexpected mock request: ${unexpected.at(-1)}`);
  };
  t.after(() => assert.deepEqual(unexpected, [], 'No unmocked or external requests'));
  return { fetcher, calls, data, writes: () => calls.filter(x => x.method !== 'GET') };
}

function cookieValue(response, name) {
  const entry = response.headers.getSetCookie().find(x => x.startsWith(`${name}=`));
  assert.ok(entry, `Response sets ${name}`);
  return entry.slice(name.length + 1).split(';')[0];
}

function assertCookie(response, name, age) {
  const entry = response.headers.getSetCookie().find(x => x.startsWith(`${name}=`));
  for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', `Max-Age=${age}`]) {
    assert.ok(entry?.split('; ').includes(attribute), `${name} has ${attribute}`);
  }
}

function assertCookiesCleared(response) {
  for (const name of [SESSION_COOKIE, OAUTH_COOKIE]) {
    assert.equal(cookieValue(response, name), '');
    assertCookie(response, name, 0);
  }
}

async function sessionCookie(env = environment(), overrides = {}) {
  const now = Date.now();
  const payload = { kind: 'session', token: TOKEN, login: 'owner', csrf: CSRF, iat: now, exp: now + 3600000, ...overrides };
  return `${SESSION_COOKIE}=${await seal(payload, env, ORIGIN, 'session')}`;
}

async function begin(env, fetcher) {
  const response = await handle(new Request(`${ORIGIN}/auth/login?returnTo=https://evil.example/`), env, fetcher);
  assert.equal(response.status, 303);
  const value = cookieValue(response, OAUTH_COOKIE);
  return { response, value, payload: await unseal(value, env, ORIGIN, 'oauth'), authorization: new URL(response.headers.get('Location')) };
}

async function callback(env, fetcher, login, params = {}) {
  const query = new URLSearchParams({ code: 'github-code', state: login.payload.state, returnTo: 'https://evil.example/', ...params });
  return handle(new Request(`${ORIGIN}/auth/callback?${query}`, { headers: { Cookie: `${OAUTH_COOKIE}=${login.value}` } }), env, fetcher);
}

async function decisionBody(value, overrides = {}) {
  return { action: 'approve', advertUrl: canonicalURL(value.url), queueSha: SHA,
    fingerprint: await fingerprint(value), ...overrides };
}

async function mutation(env, body, options = {}) {
  const headers = { Cookie: await sessionCookie(env), Origin: ORIGIN, 'X-CSRF-Token': CSRF,
    'Content-Type': 'application/json', ...options.headers };
  for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
  return new Request(`${ORIGIN}${options.path ?? '/api/decisions'}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

function isConflict(error) { return error instanceof HttpError && error.status === 409; }

test('sign-in fails closed when configuration is absent or the origin is not HTTPS', async t => {
  const mock = githubMock(t);
  for (const field of ['REPOSITORY', 'BRANCH', 'ALLOWED_GITHUB_LOGINS', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']) {
    const response = await handle(new Request(`${ORIGIN}/auth/login`), environment({ [field]: '' }), mock.fetcher);
    assert.equal(response.status, 503, field);
    assert.equal(response.headers.get('Location'), null);
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
  const response = await handle(new Request('http://admin.example.test/auth/login'), environment(), mock.fetcher);
  assert.equal(response.status, 503);
  assert.deepEqual(mock.calls, []);
});

test('sealed sessions use fresh authenticated encryption and bind origin, repository, purpose and lifetime', async () => {
  const env = environment(), payload = { kind: 'session', token: TOKEN, csrf: CSRF, iat: NOW, exp: NOW + 3600000 };
  const first = await seal(payload, env, ORIGIN, 'session');
  const second = await seal(payload, env, ORIGIN, 'session');
  assert.notEqual(first, second);
  assert.notDeepEqual(Buffer.from(first, 'base64url').subarray(0, 12), Buffer.from(second, 'base64url').subarray(0, 12));
  assert.deepEqual(await unseal(first, env, ORIGIN, 'session', NOW), payload);
  assert.ok(!Buffer.from(first, 'base64url').includes(Buffer.from(TOKEN)));
  const tampered = Buffer.from(first, 'base64url'); tampered[15] ^= 1;
  await assert.rejects(unseal(tampered.toString('base64url'), env, ORIGIN, 'session', NOW));
  await assert.rejects(unseal(first, env, 'https://other.example.test', 'session', NOW));
  await assert.rejects(unseal(first, { ...env, REPOSITORY: 'other/repo' }, ORIGIN, 'session', NOW));
  await assert.rejects(unseal(first, env, ORIGIN, 'oauth', NOW));
  await assert.rejects(unseal(first, env, ORIGIN, 'session', NOW + 3600000));
  const excessive = await seal({ ...payload, exp: NOW + 3600001 }, env, ORIGIN, 'session');
  await assert.rejects(unseal(excessive, env, ORIGIN, 'session', NOW));
});

test('OAuth callback verifies state and sends PKCE, repository restriction and the fixed redirect', async t => {
  const env = environment(), mock = githubMock(t), login = await begin(env, mock.fetcher);
  assert.equal(login.authorization.origin + login.authorization.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(login.authorization.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.equal(login.authorization.searchParams.get('client_id'), env.GITHUB_CLIENT_ID);
  assert.equal(login.authorization.searchParams.get('state'), login.payload.state);
  assert.equal(login.authorization.searchParams.get('code_challenge_method'), 'S256');
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(login.payload.verifier))).toString('base64url');
  assert.equal(login.authorization.searchParams.get('code_challenge'), challenge);
  assertCookie(login.response, OAUTH_COOKIE, 600);
  assert.ok(!login.value.includes(login.payload.verifier));
  assert.deepEqual(mock.calls, []);
  const response = await callback(env, mock.fetcher, login);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/admin.html`);
  assertCookie(response, SESSION_COOKIE, 3600);
  assertCookie(response, OAUTH_COOKIE, 0);
  const encrypted = cookieValue(response, SESSION_COOKIE);
  assert.ok(!encrypted.includes(TOKEN));
  assert.ok(!encrypted.includes(env.GITHUB_CLIENT_SECRET));
  const session = await unseal(encrypted, env, ORIGIN, 'session');
  assert.equal(session.token, TOKEN);
  assert.equal(session.login, 'owner');
  assert.ok(session.csrf.length >= 32);
  assert.equal(session.exp - session.iat, 3600000);
  assert.deepEqual(mock.calls.map(x => [x.method, x.url]), [
    ['GET', REPO_URL], ['POST', 'https://github.com/login/oauth/access_token'],
    ['GET', 'https://api.github.com/user'], ['GET', REPO_URL],
  ]);
  assert.equal(mock.calls[0].headers.has('Authorization'), false);
  const exchange = mock.calls[1];
  assert.equal(exchange.redirect, 'error');
  assert.deepEqual(exchange.body, { client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
    code: 'github-code', code_verifier: login.payload.verifier, redirect_uri: `${ORIGIN}/auth/callback`, repository_id: 123456 });
  const api = await handle(new Request(`${ORIGIN}/api/session`, { headers: { Cookie: `${SESSION_COOKIE}=${encrypted}` } }), env, mock.fetcher);
  assert.equal(api.status, 200);
  const data = await api.json();
  assert.deepEqual(data, { user: { login: 'owner' }, repository: REPOSITORY, csrfToken: session.csrf, publicSiteUrl: env.PUBLIC_SITE_URL });
  assert.ok(!JSON.stringify(data).includes(TOKEN));
});

test('OAuth state mismatch or missing state cookie clears cookies without contacting GitHub', async t => {
  const env = environment(), mock = githubMock(t), login = await begin(env, mock.fetcher);
  const response = await callback(env, mock.fetcher, login, { state: 'attacker-state' });
  assert.equal(response.headers.get('Location'), `${ORIGIN}/admin.html?authError=sign-in-failed`);
  assertCookiesCleared(response);
  const missing = await handle(new Request(`${ORIGIN}/auth/callback?code=stolen&state=anything`), env, mock.fetcher);
  assert.equal(missing.headers.get('Location'), `${ORIGIN}/admin.html?authError=expired`);
  assertCookiesCleared(missing);
  assert.deepEqual(mock.calls, []);
});

test('OAuth accepts only a usable GitHub App user bearer token', async t => {
  for (const tokenResponse of [
    { access_token: 'ghp_personal-token', token_type: 'bearer' },
    { access_token: TOKEN, token_type: 'mac' },
    { access_token: TOKEN, token_type: 'bearer', expires_in: 30 },
    { access_token: TOKEN, token_type: 'bearer', error: 'bad_verification_code' },
  ]) await t.test(JSON.stringify(tokenResponse), async sub => {
    const env = environment(), mock = githubMock(sub, { tokenResponse });
    const response = await callback(env, mock.fetcher, await begin(env, mock.fetcher));
    assert.equal(response.headers.get('Location'), `${ORIGIN}/admin.html?authError=sign-in-failed`);
    assertCookiesCleared(response);
    assert.equal(mock.calls.filter(x => x.url.startsWith(QUEUE_URL)).length, 0);
  });
});

test('allowlist and repository write permission are enforced during callback and every API request', async t => {
  for (const options of [{ login: 'intruder' }, { push: false }, { fullName: 'other/repo' }]) {
    await t.test(JSON.stringify(options), async sub => {
      const env = environment(), mock = githubMock(sub, options);
      const response = await callback(env, mock.fetcher, await begin(env, mock.fetcher));
      assert.equal(response.headers.get('Location'), `${ORIGIN}/admin.html?authError=not-authorized`);
      assertCookiesCleared(response);
      const denied = await handle(new Request(`${ORIGIN}/api/queue`, { headers: { Cookie: await sessionCookie(env) } }), env, mock.fetcher);
      assert.equal(denied.status, 403);
      assert.equal(mock.calls.filter(x => x.url.startsWith(QUEUE_URL)).length, 0);
    });
  }
});

test('unauthenticated, expired, altered or duplicate session cookies cannot read the queue', async t => {
  const env = environment(), mock = githubMock(t), valid = await sessionCookie(env);
  const expired = await sessionCookie(env, { iat: Date.now() - 20000, exp: Date.now() - 10000 });
  for (const value of ['', `${SESSION_COOKIE}=not-a-valid-session`, expired, `${valid}; ${valid}`]) {
    const response = await handle(new Request(`${ORIGIN}/api/queue`, { headers: { Cookie: value } }), env, mock.fetcher);
    assert.equal(response.status, 401);
    assert.deepEqual(Object.keys(await response.json()), ['error']);
  }
  assert.deepEqual(mock.calls, []);
});

test('mutation requires exact Origin and a matching session CSRF token before queue access', async t => {
  const env = environment(), mock = githubMock(t), body = await decisionBody(mock.data.candidates[0]);
  for (const origin of [null, 'null', 'https://attacker.example', `${ORIGIN}.attacker.example`]) {
    const response = await handle(await mutation(env, body, { headers: { Origin: origin } }), env, mock.fetcher);
    assert.equal(response.status, 403);
  }
  assert.deepEqual(mock.calls, []);
  for (const csrf of [null, 'wrong-csrf']) {
    const response = await handle(await mutation(env, body, { headers: { 'X-CSRF-Token': csrf } }), env, mock.fetcher);
    assert.equal(response.status, 403);
  }
  assert.equal(mock.calls.filter(x => x.url.startsWith(QUEUE_URL)).length, 0);
  assert.deepEqual(mock.writes(), []);
});

test('queue response omits excluded, already decided and resolved candidates, with source fingerprints', async t => {
  const pending = candidate(), excluded = candidate({ url: 'https://jobs.example.test/excluded' });
  const decided = candidate({ url: 'https://jobs.example.test/decided' });
  const resolved = candidate({ url: 'https://jobs.example.test/resolved', reviewStatus: 'approved' });
  const data = queue([pending, excluded, decided, resolved], {
    excluded: [{ url: `${excluded.url}?utm_source=archive`, reason: 'Human exclusion' }],
    decisions: [{ id: 'previous', advertUrl: decided.url, action: 'reject', decidedBy: 'owner',
      decidedAt: new Date(NOW).toISOString(), expectedCandidate: decided }],
  });
  const env = environment(), mock = githubMock(t, { queue: data });
  const response = await handle(new Request(`${ORIGIN}/api/queue`, { headers: { Cookie: await sessionCookie(env) } }), env, mock.fetcher);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.queueSha, SHA);
  assert.deepEqual(result.candidates, [{ ...pending, fingerprint: await fingerprint(pending) }]);
  assert.equal(result.history[0].resolutionStatus, 'queued');
  assert.equal('expectedCandidate' in result.history[0], false);
  assert.deepEqual(mock.writes(), []);
});

test('changed content SHA, changed fingerprint or ambiguous/decided advert never triggers a PUT', async t => {
  const original = candidate();
  const cases = [
    { name: 'queue changed', options: { sha: 'b'.repeat(40) } },
    { name: 'candidate changed', options: { queue: queue([{ ...original, title: 'A human edited this title' }]) } },
    { name: 'duplicate canonical URL', options: { queue: queue([original, { ...original, url: canonicalURL(original.url) }]) } },
    { name: 'already excluded', options: { queue: queue([original], { excluded: [{ url: original.url, reason: 'Human exclusion' }] }) } },
    { name: 'already decided', options: { queue: queue([original], { decisions: [{ advertUrl: original.url, action: 'reject' }] }) } },
  ];
  for (const { name, options } of cases) await t.test(name, async sub => {
    const env = environment(), mock = githubMock(sub, options);
    const response = await handle(await mutation(env, await decisionBody(original)), env, mock.fetcher);
    assert.equal(response.status, 409);
    assert.deepEqual(mock.writes(), []);
  });
});

test('a decision writes only the fixed main-branch queue, preserving UTF-8, raw metadata and human edits', async t => {
  const selected = candidate(), untouched = candidate({ url: 'https://jobs.example.test/another', title: 'Human-edited candidate' });
  const data = queue([selected, untouched], {
    excluded: [{ url: 'https://jobs.example.test/excluded', reason: 'Keep this human exclusion' }],
    decisions: [{ id: 'existing', advertUrl: 'https://jobs.example.test/previous', action: 'reject', resolutionStatus: 'resolved' }],
  });
  const env = environment(), mock = githubMock(t, { queue: data });
  const input = await decisionBody(selected, { branch: 'attacker-branch', repository: 'attacker/repo',
    title: 'Tampered title', expectedCandidate: { title: 'Untrusted browser snapshot' }, decidedBy: 'impersonated-admin' });
  const response = await handle(await mutation(env, input), env, mock.fetcher);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.saved, true);
  assert.equal(result.publication, 'queued');
  assert.equal(result.commitUrl, `https://github.com/${REPOSITORY}/commit/${COMMIT_SHA}`);
  const writes = mock.writes();
  assert.equal(writes.length, 1, 'No opportunities write or workflow dispatch');
  assert.equal(writes[0].method, 'PUT');
  assert.equal(writes[0].url, QUEUE_URL);
  assert.equal(writes[0].body.sha, SHA);
  assert.equal(writes[0].body.branch, 'main');
  const saved = JSON.parse(Buffer.from(writes[0].body.content, 'base64').toString('utf8'));
  assert.deepEqual(saved.candidates, data.candidates);
  assert.deepEqual(saved.excluded, data.excluded);
  assert.deepEqual(saved.collectorMetadata, data.collectorMetadata);
  assert.deepEqual(saved.decisions[0], data.decisions[0]);
  const audit = saved.decisions[1];
  assert.match(audit.id, /^decision-[0-9a-f-]{36}$/);
  assert.equal(audit.id, result.decisionId);
  assert.equal(audit.action, 'approve');
  assert.equal(audit.decidedBy, 'owner');
  assert.equal(audit.advertUrl, canonicalURL(selected.url));
  assert.ok(Number.isFinite(Date.parse(audit.decidedAt)));
  assert.deepEqual(audit.expectedCandidate, selected);
  assert.ok(!JSON.stringify(saved).includes(TOKEN));
});

test('approval requires a valid source sighting within 30 days and no known expiry', () => {
  const fresh = candidate({ lastSeen: '2026-10-01' });
  assert.doesNotThrow(() => approvalAllowed(fresh, NOW));
  assert.doesNotThrow(() => approvalAllowed({ ...fresh, lastSeen: '2026-09-01' }, NOW));
  assert.doesNotThrow(() => approvalAllowed({ ...fresh, deadline: '2026-10-01' }, NOW));
  assert.doesNotThrow(() => approvalAllowed({ ...fresh, deadlineAt: '2026-10-01T12:00:01Z' }, NOW));
  // London has already crossed midnight while UTC remains on the previous day.
  assert.doesNotThrow(() => approvalAllowed(fresh, Date.UTC(2026, 8, 30, 23, 30)));
  const disallowed = [
    { lastSeen: '2026-08-31' }, { lastSeen: '2026-10-02' }, { lastSeen: null },
    { lastSeen: '2026-99-99' }, { lastSeen: '2026-02-30' },
    { deadline: '2026-09-30' }, { deadlineSuggestion: '2026-09-30' }, { deadline: '2026-99-99' },
    { deadlineAt: '2026-10-01T12:00:00Z' }, { deadlineAt: 'not-a-date' },
    { status: 'closed' }, { status: 'withdrawn' },
  ];
  for (const change of disallowed) assert.throws(() => approvalAllowed({ ...fresh, ...change }, NOW), isConflict, JSON.stringify(change));
});

test('stale approval performs no PUT, but rejecting a stale expired advert is allowed and audited', async t => {
  const stale = candidate({ lastSeen: '2026-08-01', deadline: '2026-08-31', status: 'closed' });
  const env = environment(), mock = githubMock(t, { queue: queue([stale]) });
  const value = { login: 'owner', token: TOKEN };
  await assert.rejects(saveDecision(await mutation(env, await decisionBody(stale)), env, value, mock.fetcher, NOW), isConflict);
  assert.deepEqual(mock.writes(), []);
  const saved = await saveDecision(await mutation(env, await decisionBody(stale, { action: 'reject' })), env, value, mock.fetcher, NOW);
  assert.equal(saved.saved, true);
  assert.equal(mock.writes().length, 1);
  const data = JSON.parse(Buffer.from(mock.writes()[0].body.content, 'base64').toString('utf8'));
  assert.equal(data.decisions[0].action, 'reject');
  assert.equal(data.decisions[0].decidedAt, new Date(NOW).toISOString());
  assert.deepEqual(data.decisions[0].expectedCandidate, stale);
});

test('a concurrent GitHub Contents API conflict is reported without retrying or force-writing', async t => {
  const env = environment(), mock = githubMock(t, { putStatus: 409, putResponse: { message: 'SHA does not match' } });
  const response = await handle(await mutation(env, await decisionBody(mock.data.candidates[0])), env, mock.fetcher);
  assert.equal(response.status, 409);
  assert.equal(mock.writes().length, 1);
  assert.equal(mock.writes()[0].body.sha, SHA);
});

test('fingerprint ignores object key order but detects source metadata edits', async () => {
  assert.equal(await fingerprint({ title: 'A', raw: { b: 2, a: 1 } }), await fingerprint({ raw: { a: 1, b: 2 }, title: 'A' }));
  assert.notEqual(await fingerprint({ title: 'A', raw: { salary: 1 } }), await fingerprint({ title: 'A', raw: { salary: 2 } }));
});

test('logout clears both secure cookies locally, with Origin and live-session CSRF protection', async t => {
  const env = environment(), mock = githubMock(t);
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: null }, { 'X-CSRF-Token': 'wrong' }]) {
    const response = await handle(await mutation(env, {}, { path: '/auth/logout', headers }), env, mock.fetcher);
    assert.equal(response.status, 403);
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
  const response = await handle(await mutation(env, {}, { path: '/auth/logout' }), env, mock.fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedOut: true });
  assertCookiesCleared(response);
  const expired = await sessionCookie(env, { iat: Date.now() - 20000, exp: Date.now() - 10000 });
  const expiredResponse = await handle(await mutation(env, {}, { path: '/auth/logout', headers: { Cookie: expired, 'X-CSRF-Token': null } }), env, mock.fetcher);
  assert.equal(expiredResponse.status, 200);
  assertCookiesCleared(expiredResponse);
  assert.deepEqual(mock.calls, []);
});

test('only explicit public assets and safe configuration are served, without CORS or queue exposure', async t => {
  const assets = [], mock = githubMock(t), env = environment({ ASSETS: {
    fetch: async request => { assets.push(new URL(request.url).pathname); return new Response('public asset', { headers: { 'Content-Type': 'text/html' } }); },
  } });
  for (const path of ['/', '/admin.html', '/admin.js', '/admin.css', '/styles.css', '/assets/harper-adams-logo.png', '/assets/montserrat-400.woff2']) {
    const response = await handle(new Request(`${ORIGIN}${path}`), env, mock.fetcher);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const count = assets.length;
  for (const path of ['/data/review-queue.json', '/data/opportunities.json', '/site/data/review-queue.json', '/worker.js', '/wrangler.jsonc', '/.dev.vars', '/api/config', '/assets/secret.json']) {
    const response = await handle(new Request(`${ORIGIN}${path}`), env, mock.fetcher);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(assets.length, count, 'Unlisted assets never reach the asset binding');
  const preflight = await handle(new Request(`${ORIGIN}/api/decisions`, {
    method: 'OPTIONS', headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' },
  }), env, mock.fetcher);
  assert.equal(preflight.status, 404);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), null);
  const config = await handle(new Request(`${ORIGIN}/admin-config.json`), env, mock.fetcher);
  assert.deepEqual(await config.json(), { apiBase: ORIGIN, publicSiteUrl: env.PUBLIC_SITE_URL });
  assert.deepEqual(mock.calls, []);
});
