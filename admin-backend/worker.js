// A GitHub App signs in the owner; only the review queue can be changed here.
// GitHub credentials are encrypted in HttpOnly cookies, never returned to JavaScript.
const QUEUE_PATH = 'data/review-queue.json';
const SESSION_COOKIE = '__Host-hau_admin';
const OAUTH_COOKIE = '__Host-hau_oauth';
const SESSION_SECONDS = 3600;
const OAUTH_SECONDS = 600;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function reply(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ ...SECURITY_HEADERS, Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function cookie(name, value, age) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}

function clearCookies() {
  return [cookie(SESSION_COOKIE, '', 0), cookie(OAUTH_COOKIE, '', 0)];
}

function readCookie(request, name) {
  const values = (request.headers.get('Cookie') || '').split(';').map(x => x.trim())
    .filter(x => x.startsWith(`${name}=`)).map(x => x.slice(name.length + 1));
  return values.length === 1 ? values[0] : '';
}

function bytesToBase64(bytes) {
  return btoa(Array.from(bytes, x => String.fromCharCode(x)).join(''));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), x => x.charCodeAt(0));
}

function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) throw new Error('Invalid cookie');
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
}

function randomValue(length = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(length)));
}

export function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export async function fingerprint(candidate) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(stableJSON(candidate)));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

function configuration(env, origin) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.REPOSITORY || '') ||
      !/^[A-Za-z0-9._/-]+$/.test(env.BRANCH || '') || !env.ALLOWED_GITHUB_LOGINS ||
      !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET ||
      typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32 ||
      new URL(origin).protocol !== 'https:') {
    throw new HttpError(503, 'Sign-in is not configured yet.');
  }
  const admins = env.ALLOWED_GITHUB_LOGINS.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!admins.length || admins.some(x => !/^[a-z0-9-]+$/.test(x))) {
    throw new HttpError(503, 'Sign-in is not configured yet.');
  }
  return { admins, repository: env.REPOSITORY, branch: env.BRANCH };
}

async function encryptionKey(env) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(payload, env, origin, purpose) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce,
    additionalData: encoder.encode(`hau-admin:v1:${origin}:${env.REPOSITORY}:${purpose}`),
  }, await encryptionKey(env), encoder.encode(JSON.stringify(payload))));
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce); result.set(ciphertext, nonce.length);
  return base64url(result);
}

export async function unseal(value, env, origin, purpose, now = Date.now()) {
  const bytes = fromBase64url(value);
  if (bytes.length < 29) throw new Error('Invalid cookie');
  const plain = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: bytes.slice(0, 12),
    additionalData: encoder.encode(`hau-admin:v1:${origin}:${env.REPOSITORY}:${purpose}`),
  }, await encryptionKey(env), bytes.slice(12));
  const payload = JSON.parse(decoder.decode(plain));
  const maximum = purpose === 'session' ? SESSION_SECONDS : OAUTH_SECONDS;
  if (!payload || payload.kind !== purpose || !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= now || payload.iat > now + 5000 ||
      payload.exp <= payload.iat || payload.exp - payload.iat > maximum * 1000) {
    throw new Error('Expired cookie');
  }
  return payload;
}

async function github(env, token, path, method = 'GET', body, fetcher = fetch) {
  const response = await fetcher(`https://api.github.com${path}`, {
    method, headers: {
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'hau-opportunities-admin', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if ([409, 422].includes(response.status) && method === 'PUT') {
      throw new HttpError(409, 'The queue changed. Reload it before deciding.');
    }
    if (response.status === 401) throw new HttpError(401, 'Sign in to continue.');
    if (response.status === 403 || response.status === 404) {
      throw new HttpError(403, 'This account or GitHub App cannot access the repository.');
    }
    throw new HttpError(502, 'GitHub is unavailable. Nothing was saved; try again later.');
  }
  return response.json();
}

async function authorizeToken(token, env, origin, fetcher) {
  const config = configuration(env, origin);
  const user = await github(env, token, '/user', 'GET', undefined, fetcher);
  if (!config.admins.includes(String(user.login || '').toLowerCase())) {
    throw new HttpError(403, 'This GitHub account is not an allowed admin.');
  }
  const repo = await github(env, token, `/repos/${config.repository}`, 'GET', undefined, fetcher);
  if (String(repo.full_name || '').toLowerCase() !== config.repository.toLowerCase() || repo.permissions?.push !== true) {
    throw new HttpError(403, 'Repository write access is required.');
  }
  return { login: user.login, repository: config.repository };
}

async function session(request, env, origin, fetcher) {
  configuration(env, origin);
  let value;
  try { value = await unseal(readCookie(request, SESSION_COOKIE), env, origin, 'session'); }
  catch { throw new HttpError(401, 'Sign in to continue.'); }
  if (typeof value.token !== 'string' || !value.token || typeof value.csrf !== 'string' || !value.csrf) {
    throw new HttpError(401, 'Sign in to continue.');
  }
  const current = await authorizeToken(value.token, env, origin, fetcher);
  if (current.login !== value.login) throw new HttpError(401, 'Sign in to continue.');
  return value;
}

function requireSameOrigin(request, origin) {
  if (request.headers.get('Origin') !== origin) throw new HttpError(403, 'Use the admin page to save decisions.');
}

function csrf(request, value) {
  if (request.headers.get('X-CSRF-Token') !== value.csrf) throw new HttpError(403, 'Reload the admin page before saving.');
}

export function canonicalURL(value) {
  if (typeof value !== 'string' || /\s/.test(value) || value.length > 4096) throw new HttpError(400, 'Invalid advert URL.');
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Invalid advert URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new HttpError(400, 'Invalid advert URL.');
  const entries = [...url.searchParams].filter(([key]) => !key.toLowerCase().startsWith('utm_') &&
    !['fbclid', 'gclid', 'from_rss'].includes(key.toLowerCase()));
  entries.sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  url.hash = ''; url.search = new URLSearchParams(entries).toString();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href.replace(/\/$/, url.pathname === '/' && !url.search ? '/' : '');
}

export function approvalAllowed(candidate, now = Date.now()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = candidate.lastSeen;
  const sighting = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(sighting.getTime()) || sighting.toISOString().slice(0, 10) !== date ||
      date > today || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`) > 30 * 86400000) {
    throw new HttpError(409, 'This advert has no recent source sighting. Refresh collection before approving.');
  }
  if (candidate.deadlineAt) {
    if (!Number.isFinite(Date.parse(candidate.deadlineAt)) || Date.parse(candidate.deadlineAt) <= now) {
      throw new HttpError(409, 'This advert has passed its known closing time.');
    }
  } else if (candidate.deadlineSuggestion || candidate.deadline) {
    const closing = candidate.deadlineSuggestion || candidate.deadline;
    const parsed = new Date(`${closing}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closing) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== closing) {
      throw new HttpError(409, 'This advert has an invalid closing date; correct it before approving.');
    }
    if (closing < today) throw new HttpError(409, 'This advert has passed its known closing date.');
  }
  if (['closed', 'withdrawn'].includes(candidate.status)) throw new HttpError(409, 'This advert is closed or withdrawn.');
}

async function loadQueue(env, token, fetcher) {
  const path = `/repos/${env.REPOSITORY}/contents/${QUEUE_PATH}?ref=${encodeURIComponent(env.BRANCH)}`;
  const file = await github(env, token, path, 'GET', undefined, fetcher);
  if (file.type !== 'file' || file.encoding !== 'base64' || !/^[a-f0-9]{40}$/.test(file.sha || '') ||
      typeof file.content !== 'string' || file.content.length > 1400000) {
    throw new HttpError(502, 'The review queue cannot be read. Check the repository data file.');
  }
  let queue;
  try { queue = JSON.parse(decoder.decode(base64ToBytes(file.content.replace(/\s/g, '')))); }
  catch { throw new HttpError(502, 'The review queue is invalid. Check the repository data file.'); }
  if (!queue || typeof queue !== 'object' || !Array.isArray(queue.candidates) || !Array.isArray(queue.excluded) ||
      (queue.decisions !== undefined && !Array.isArray(queue.decisions)) || queue.candidates.some(c => !c || typeof c !== 'object' || Array.isArray(c))) {
    throw new HttpError(502, 'The review queue is invalid. Check the repository data file.');
  }
  queue.decisions ||= [];
  return { queue, sha: file.sha };
}

function unresolvedDecisions(queue) {
  return queue.decisions.filter(x => !x.resolutionStatus);
}

function pendingCandidates(queue) {
  const decided = new Set(unresolvedDecisions(queue).map(x => canonicalURL(x.advertUrl)));
  const excluded = new Set(queue.excluded.map(x => canonicalURL(x.url)));
  return queue.candidates.filter(x => !['approved', 'rejected', 'resolved'].includes(x.reviewStatus) &&
    !excluded.has(canonicalURL(x.url)) && !decided.has(canonicalURL(x.url)));
}

export async function saveDecision(request, env, value, fetcher = fetch, now = Date.now()) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Use a JSON decision.');
  if (Number(request.headers.get('Content-Length') || 0) > 8192) throw new HttpError(413, 'Decision is too large.');
  const raw = await request.text();
  if (encoder.encode(raw).length > 8192) throw new HttpError(413, 'Decision is too large.');
  let input;
  try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid decision.'); }
  if (!input || !['approve', 'reject'].includes(input.action) || !/^[a-f0-9]{40}$/.test(input.queueSha || '') ||
      !/^[a-f0-9]{64}$/.test(input.fingerprint || '')) throw new HttpError(400, 'Invalid decision.');
  const advertUrl = canonicalURL(input.advertUrl);
  const { queue, sha } = await loadQueue(env, value.token, fetcher);
  if (sha !== input.queueSha) throw new HttpError(409, 'The queue changed. Reload it before deciding.');
  const matches = pendingCandidates(queue).filter(x => canonicalURL(x.url) === advertUrl);
  if (matches.length !== 1 || await fingerprint(matches[0]) !== input.fingerprint) {
    throw new HttpError(409, 'The advert changed or was already decided. Reload the queue.');
  }
  const candidate = matches[0];
  if (input.action === 'approve') approvalAllowed(candidate, now);
  const decision = { id: `decision-${crypto.randomUUID()}`, advertUrl, action: input.action,
    decidedBy: value.login, decidedAt: new Date(now).toISOString(), expectedCandidate: candidate };
  queue.decisions.push(decision);
  const result = await github(env, value.token, `/repos/${env.REPOSITORY}/contents/${QUEUE_PATH}`, 'PUT', {
    message: `${input.action === 'approve' ? 'Approve' : 'Reject'} an uncertain advert (${value.login})`,
    sha, branch: env.BRANCH, content: bytesToBase64(encoder.encode(JSON.stringify(queue, null, 2) + '\n')),
  }, fetcher);
  if (!result.commit?.sha) throw new HttpError(502, 'GitHub did not confirm the save. Reload the queue before trying again.');
  return { saved: true, decisionId: decision.id, commitUrl: `https://github.com/${env.REPOSITORY}/commit/${result.commit.sha}`,
    publication: 'queued' };
}

async function beginLogin(env, origin) {
  configuration(env, origin);
  const now = Date.now(), state = randomValue(), verifier = randomValue();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${origin}/auth/callback`,
    state, code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'false', prompt: 'select_account' });
  const payload = await seal({ kind: 'oauth', state, verifier, iat: now, exp: now + OAUTH_SECONDS * 1000 }, env, origin, 'oauth');
  return redirect(url.href, [cookie(OAUTH_COOKIE, payload, OAUTH_SECONDS)]);
}

async function completeLogin(request, env, origin, fetcher) {
  const config = configuration(env, origin), url = new URL(request.url);
  let state;
  try { state = await unseal(readCookie(request, OAUTH_COOKIE), env, origin, 'oauth'); }
  catch { return redirect(`${origin}/admin.html?authError=expired`, clearCookies()); }
  if (url.searchParams.get('state') !== state.state) return redirect(`${origin}/admin.html?authError=sign-in-failed`, clearCookies());
  if (url.searchParams.has('error')) return redirect(`${origin}/admin.html?authError=cancelled`, clearCookies());
  const code = url.searchParams.get('code');
  if (!code || code.length > 512) return redirect(`${origin}/admin.html?authError=sign-in-failed`, clearCookies());
  try {
    // Public metadata identifies the configured repository before requesting a narrowed token.
    const repo = await github(env, null, `/repos/${config.repository}`, 'GET', undefined, fetcher);
    if (!Number.isSafeInteger(repo.id)) throw new HttpError(502, 'Repository metadata is unavailable.');
    const result = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
        code, code_verifier: state.verifier, redirect_uri: `${origin}/auth/callback`, repository_id: repo.id }),
    });
    const token = await result.json();
    if (!result.ok || token.error || typeof token.access_token !== 'string' || !token.access_token.startsWith('ghu_') ||
        token.token_type !== 'bearer') throw new HttpError(401, 'Sign in failed.');
    const user = await authorizeToken(token.access_token, env, origin, fetcher);
    const seconds = Math.min(SESSION_SECONDS, Number.isFinite(token.expires_in) ? Math.max(0, Math.floor(token.expires_in)) : SESSION_SECONDS);
    if (seconds < 60) throw new HttpError(401, 'Sign in failed.');
    const now = Date.now();
    const value = await seal({ kind: 'session', token: token.access_token, login: user.login,
      csrf: randomValue(), iat: now, exp: now + seconds * 1000 }, env, origin, 'session');
    return redirect(`${origin}/admin.html`, [cookie(SESSION_COOKIE, value, seconds), cookie(OAUTH_COOKIE, '', 0)]);
  } catch (error) {
    return redirect(`${origin}/admin.html?authError=${error instanceof HttpError && error.status === 403 ? 'not-authorized' : 'sign-in-failed'}`, clearCookies());
  }
}

export async function handle(request, env, fetcher = fetch) {
  const url = new URL(request.url), origin = url.origin;
  try {
    if (url.pathname === '/admin-config.json' && request.method === 'GET') {
      return reply({ apiBase: origin, publicSiteUrl: env.PUBLIC_SITE_URL });
    }
    if (url.pathname === '/auth/login' && request.method === 'GET') return await beginLogin(env, origin);
    if (url.pathname === '/auth/callback' && request.method === 'GET') return await completeLogin(request, env, origin, fetcher);
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      requireSameOrigin(request, origin);
      let value;
      try { value = await unseal(readCookie(request, SESSION_COOKIE), env, origin, 'session'); } catch {}
      if (value) csrf(request, value);
      const response = reply({ signedOut: true });
      for (const expired of clearCookies()) response.headers.append('Set-Cookie', expired);
      return response;
    }
    if (url.pathname.startsWith('/api/') || url.pathname === '/auth/logout') {
      const route = `${request.method} ${url.pathname}`;
      if (!['GET /api/session', 'GET /api/queue', 'POST /api/decisions'].includes(route)) {
        throw new HttpError(404, 'Not found.');
      }
      if (request.method === 'POST') requireSameOrigin(request, origin);
      const value = await session(request, env, origin, fetcher);
      if (request.method === 'POST') csrf(request, value);
      if (route === 'GET /api/session') return reply({ user: { login: value.login }, repository: env.REPOSITORY,
        csrfToken: value.csrf, publicSiteUrl: env.PUBLIC_SITE_URL });
      if (route === 'GET /api/queue') {
        const { queue, sha } = await loadQueue(env, value.token, fetcher);
        const candidates = await Promise.all(pendingCandidates(queue).map(async candidate => ({
          ...candidate, fingerprint: await fingerprint(candidate),
        })));
        const history = queue.decisions.slice(-100).reverse().map(x => ({ id: x.id, advertUrl: x.advertUrl,
          title: x.expectedCandidate?.title, action: x.action, decidedBy: x.decidedBy, decidedAt: x.decidedAt,
          resolutionStatus: x.resolutionStatus || 'queued', resolutionReason: x.resolutionReason }));
        return reply({ candidates, queueSha: sha, history });
      }
      if (route === 'POST /api/decisions') return reply(await saveDecision(request, env, value, fetcher));
    }
    if (request.method === 'GET' && ['/', '/admin.html'].includes(url.pathname)) {
      const asset = new URL('/admin.html', origin);
      const response = await env.ASSETS.fetch(new Request(asset));
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method === 'GET' && (/^\/(admin\.js|admin\.css|styles\.css)$/.test(url.pathname) ||
        /^\/assets\/(harper-adams-logo\.png|montserrat-(400|500|600|700)\.woff2)$/.test(url.pathname))) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    }
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    return reply({ error: error instanceof HttpError ? error.message : 'The admin service is unavailable. Please try again later.' },
      error instanceof HttpError ? error.status : 503);
  }
}

export default { fetch: (request, env) => handle(request, env) };
