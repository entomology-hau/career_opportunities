import test from 'node:test';
import assert from 'node:assert/strict';
import { handleResearch, ResearchLibrary } from './research.js';

// In-memory storage models atomic transactions and DO request serialisation.
// No test sends network requests or touches production access records.
const ORIGIN = 'https://research.example.test';
const PASSWORD = 'A long shared research passphrase 2026';
const EMAIL = 'student@harper-adams.ac.uk';
const PREFIX = '/research-api';
const future = (days = 30) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); this.failOn = null; }
  async get(key) {
    if (Array.isArray(key)) { assert.ok(key.length <= 128); return new Map(key.filter(k => this.data.has(k)).map(k => [k, structuredClone(this.data.get(k))])); }
    return structuredClone(this.data.get(key));
  }
  async put(key, value) {
    const entries = typeof key === 'string' ? [[key, value]] : Object.entries(key);
    assert.ok(entries.length <= 128, 'storage batches must remain within128 keys');
    for (const [k, v] of entries) {
      if (this.failOn && k.startsWith(this.failOn)) throw new Error('Simulated storage failure');
      if (k.startsWith('file:')) assert.ok(v.byteLength <= 64 * 1024, 'document chunk bound');
      this.data.set(k, structuredClone(v));
    }
  }
  async delete(key) {
    if (Array.isArray(key)) { assert.ok(key.length <= 128); key.forEach(k => this.data.delete(k)); return key.length; }
    return this.data.delete(key);
  }
  async list({ prefix = '', limit = Infinity } = {}) {
    return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)]));
  }
  async transaction(callback) {
    const tx = new MemoryStorage(structuredClone([...this.data])); tx.failOn = this.failOn;
    const result = await callback(tx); this.data = tx.data; return result;
  }
}
function fixture() {
  const storage = new MemoryStorage(); let queue = Promise.resolve();
  const ctx = { storage, blockConcurrencyWhile: callback => { const next = queue.then(callback); queue = next.catch(() => {}); return next; } };
  const env = { SESSION_SECRET: 'existing-worker-secret-for-rate-key-privacy' };
  const object = new ResearchLibrary(ctx, env), calls = [];
  env.RESEARCH_LIBRARY = {
    idFromName: name => { assert.equal(name, 'hau-research-v1'); return 'private-id'; },
    get: id => { assert.equal(id, 'private-id'); return { fetch: request => { calls.push(request.clone()); return object.fetch(request); } }; },
  };
  async function send(path, options = {}) {
    const method = options.method || 'GET';
    const headers = new Headers({ 'CF-Connecting-IP': '192.0.2.20', ...(options.headers || {}) });
    if (!['GET', 'HEAD'].includes(method) && !headers.has('Origin')) headers.set('Origin', ORIGIN);
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof ReadableStream) && !(body instanceof Uint8Array) && typeof body !== 'string') { headers.set('Content-Type', 'application/json'); body = JSON.stringify(body); }
    const request = new Request(`${ORIGIN}${PREFIX}${path}`, { method, headers, ...(body === undefined ? {} : { body }), ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
    return await handleResearch(request, env, options.admin ? { admin: { login: 'entomology-hau' } } : {});
  }
  async function configure() {
    assert.equal((await send('/admin/users', { admin: true, method: 'POST', body: { email: EMAIL } })).status, 200);
    assert.equal((await send('/admin/password', { admin: true, method: 'PUT', body: { password: PASSWORD, expiresAt: future() } })).status, 200);
  }
  async function login(password = PASSWORD, email = EMAIL) {
    const response = await send('/login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json(), cookie = response.headers.get('Set-Cookie').split(';')[0];
    return { response, body, cookie, headers: { Cookie: cookie, 'X-CSRF-Token': body.csrfToken } };
  }
  return { storage, env, object, calls, send, configure, login };
}
function uploadForm(overrides = {}) {
  const form = new FormData();
  form.set('file', new Blob([overrides.bytes ?? 'Research protocol example'], { type: 'application/octet-stream' }), overrides.filename || 'protocol.pdf');
  for (const [key, value] of Object.entries({ title: 'Laboratory method', category: 'protocol', description: 'For supervised research', version: '1.0', reviewDate: future(60), ...overrides })) {
    if (!['bytes', 'filename'].includes(key)) form.set(key, value);
  }
  return form;
}
async function uploaded(f, form = uploadForm()) {
  const response = await f.send('/admin/documents', { method: 'POST', admin: true, body: form });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).document;
}

test('blank configuration denies students and exposes no approved emails or documents', async () => {
  const f = fixture();
  for (const path of ['/session', '/documents', '/documents/123/download']) assert.equal((await f.send(path)).status, 401);
  const response = await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  assert.equal(response.status, 401); assert.match((await response.json()).error, /incorrect, or access has expired/);
  const state = await (await f.send('/admin/state', { admin: true })).json();
  assert.deepEqual(state.users, []); assert.equal(state.password.configured, false); assert.deepEqual(state.documents, []);
});

test('allowlisted email and shared password issue a secure eight-hour cookie and opaque stored session', async () => {
  const f = fixture(); await f.configure(); const session = await f.login();
  const header = session.response.headers.get('Set-Cookie');
  for (const text of ['__Host-hau_research=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=28800']) assert.ok(header.includes(text));
  assert.deepEqual(session.body.user, { email: EMAIL });
  const records = [...f.storage.data].filter(([key]) => key.startsWith('session:'));
  assert.equal(records.length, 1); assert.match(records[0][0], /^session:[a-f0-9]{64}$/);
  const raw = session.cookie.split('=')[1]; assert.equal(JSON.stringify(records).includes(raw), false);
  assert.equal(JSON.stringify([...f.storage.data]).includes(PASSWORD), false);
  const state = await f.send('/session', { headers: session.headers });
  assert.equal(state.status, 200); assert.equal((await state.json()).csrfToken, session.body.csrfToken);
});

test('email case and surrounding spaces are normalised', async () => {
  const f = fixture(); await f.configure(); const session = await f.login(PASSWORD, ' STUDENT@HARPER-ADAMS.AC.UK ');
  assert.equal(session.body.user.email, EMAIL);
  await f.send('/admin/users', { method: 'POST', admin: true, body: { email: EMAIL.toUpperCase() } });
  assert.equal((await (await f.send('/admin/state', { admin: true })).json()).users.length, 1);
});

test('unapproved email, malformed email, wrong password and expired access return the same generic error', async () => {
  const f = fixture(); await f.configure();
  const attempts = [[PASSWORD, 'unknown@example.org'], [PASSWORD, 'not-an-email'], ['not the real shared password', EMAIL]];
  const errors = [];
  for (const [password, email] of attempts) {
    const response = await f.send('/login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 401); errors.push((await response.json()).error);
  }
  const current = await f.storage.get('password'); current.expiresAt = Date.now() - 1; await f.storage.put('password', current);
  const response = await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  assert.equal(response.status, 401); errors.push((await response.json()).error);
  assert.equal(new Set(errors).size, 1);
});

test('allowlist removal immediately denies existing sessions and re-adding email does not revive them', async () => {
  const f = fixture(); await f.configure(); const old = await f.login();
  await f.send('/admin/users', { method: 'DELETE', admin: true, body: { email: EMAIL } });
  assert.equal((await f.send('/documents', { headers: old.headers })).status, 401);
  await f.send('/admin/users', { method: 'POST', admin: true, body: { email: EMAIL } });
  assert.equal((await f.send('/session', { headers: old.headers })).status, 401);
  assert.equal((await f.login()).response.status, 200);
});

test('remove and re-add before any session check still invalidates the prior session', async () => {
  const f = fixture(); await f.configure(); const old = await f.login();
  await f.send('/admin/users', { method: 'DELETE', admin: true, body: { email: EMAIL } });
  await f.send('/admin/users', { method: 'POST', admin: true, body: { email: EMAIL } });
  assert.equal((await f.send('/session', { headers: old.headers })).status, 401);
});

test('password rotation invalidates all prior sessions and rejects the previous password', async () => {
  const f = fixture(); await f.configure(); const old = await f.login();
  const replacement = 'A different long research passphrase 2027';
  assert.equal((await f.send('/admin/password', { method: 'PUT', admin: true, body: { password: replacement, expiresAt: future(100) } })).status, 200);
  assert.equal((await f.send('/documents', { headers: old.headers })).status, 401);
  assert.equal((await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })).status, 401);
  assert.equal((await f.login(replacement)).response.status, 200);
});

test('password expiry and session lifetime are enforced on every document request', async () => {
  const f = fixture(); await f.configure(); const session = await f.login();
  const key = [...f.storage.data.keys()].find(x => x.startsWith('session:'));
  const value = await f.storage.get(key); value.expiresAt = Date.now() - 1; await f.storage.put(key, value);
  assert.equal((await f.send('/documents', { headers: session.headers })).status, 401);
  const second = await f.login(); const password = await f.storage.get('password'); password.expiresAt = Date.now() - 1; await f.storage.put('password', password);
  assert.equal((await f.send('/documents', { headers: second.headers })).status, 401);
});

test('logout requires same-origin and a matching CSRF token and destroys the session', async () => {
  const f = fixture(); await f.configure(); const session = await f.login();
  assert.equal((await f.send('/logout', { method: 'POST', headers: { Cookie: session.cookie } })).status, 403);
  assert.equal((await f.send('/logout', { method: 'POST', headers: { ...session.headers, Origin: 'https://attacker.example' } })).status, 403);
  const out = await f.send('/logout', { method: 'POST', headers: session.headers });
  assert.equal(out.status, 200); assert.match(out.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await f.send('/session', { headers: session.headers })).status, 401);
});

test('login and every admin mutation require exact origin; no CORS access is enabled', async () => {
  const f = fixture(); await f.configure();
  for (const [path, method, body] of [['/login', 'POST', { email: EMAIL, password: PASSWORD }], ['/admin/users', 'POST', { email: 'next@example.org' }], ['/admin/password', 'PUT', { password: PASSWORD, expiresAt: future() }]]) {
    const response = await f.send(path, { method, admin: true, body, headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.status, 403); assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  }
  const request = new Request(`${ORIGIN}/research-api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  assert.equal((await handleResearch(request, f.env)).status, 403);
});

test('forged internal admin headers cannot access admin endpoints', async () => {
  const f = fixture();
  const response = await f.send('/admin/state', { headers: { 'X-Hau-Research-Admin': 'entomology-hau', 'X-Hau-Research-Origin': ORIGIN } });
  assert.equal(response.status, 403); assert.equal(f.calls.length, 0);
});

test('public calls strip spoofed internal trust headers and rebuild origin and IP', async () => {
  const f = fixture();
  await f.send('/session', { headers: { 'X-Hau-Research-Admin': 'entomology-hau', 'X-Hau-Research-Origin': 'https://attacker.example', 'X-Hau-Research-IP': 'spoofed', Authorization: 'Bearer attacker' } });
  const headers = f.calls[0].headers;
  assert.equal(headers.has('X-Hau-Research-Admin'), false);
  assert.equal(headers.get('X-Hau-Research-Origin'), ORIGIN);
  assert.equal(headers.get('X-Hau-Research-IP'), '192.0.2.20');
  assert.equal(headers.has('Authorization'), false);
});

test('admin state never returns password hashes, salts, user versions or session tokens', async () => {
  const f = fixture(); await f.configure(); await f.login();
  const response = await f.send('/admin/state', { admin: true });
  const text = await response.text();
  for (const sensitive of ['salt', 'hash', 'iterations', 'csrf', PASSWORD, 'userVersion', 'passwordVersion']) assert.equal(text.includes(sensitive), false);
  const body = JSON.parse(text); assert.equal(body.password.configured, true); assert.equal(body.storageBytes, 0); assert.equal(body.maxStorageBytes, 100 * 1024 * 1024);
});

test('admin password validation rejects short, reused, expired and invalid date inputs', async () => {
  const f = fixture(); await f.configure();
  const bad = [
    { password: 'too-short', expiresAt: future() }, { password: ' '.repeat(20), expiresAt: future() },
    { password: 'x'.repeat(257), expiresAt: future() }, { password: PASSWORD, expiresAt: future() },
    { password: PASSWORD + 'next', expiresAt: '2026-02-30' }, { password: PASSWORD + 'next', expiresAt: '2020-01-01' },
    { password: PASSWORD + 'next', expiresAt: future(367) }, { password: PASSWORD + 'next', expiresAt: 'tomorrow' },
  ];
  for (const body of bad) assert.equal((await f.send('/admin/password', { method: 'PUT', admin: true, body })).status, 400);
});

test('invalid email input and allowlist capacity fail without partial changes', async () => {
  const f = fixture();
  for (const email of ['missing-domain', 'name@domain', 'x\n@example.com', {}, 'x'.repeat(65) + '@example.org']) assert.equal((await f.send('/admin/users', { method: 'POST', admin: true, body: { email } })).status, 400);
  for (let i = 0; i < 1000; i++) await f.storage.put(`user:u${i}@example.org`, { email: `u${i}@example.org`, addedAt: new Date().toISOString(), version: String(i) });
  assert.equal((await f.send('/admin/users', { method: 'POST', admin: true, body: { email: 'extra@example.org' } })).status, 409);
  assert.equal((await f.send('/admin/users', { method: 'POST', admin: true, body: { email: 'u0@example.org' } })).status, 200);
});

test('per-IP sign-in throttling is persistent, bounded and does not store raw IP addresses', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) assert.equal((await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })).status, 401);
  assert.equal((await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })).status, 429);
  const rates = await f.storage.get('login-rates'); assert.equal(rates.total, 20); assert.equal(Object.keys(rates.ips).length, 1); assert.equal(JSON.stringify(rates).includes('192.0.2.20'), false);
  rates.startedAt -= 16 * 60000; await f.storage.put('login-rates', rates);
  assert.equal((await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })).status, 401);
});

test('global sign-in throttle blocks distributed attempts', async () => {
  const f = fixture(); await f.storage.put('login-rates', { startedAt: Date.now(), total: 200, ips: {} });
  const response = await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: { 'CF-Connecting-IP': '198.51.100.7' } });
  assert.equal(response.status, 429);
});

test('expired and stale sessions are pruned and active session storage is capped', async () => {
  const f = fixture(); await f.configure(); const password = await f.storage.get('password');
  await f.storage.put('session:expired', { expiresAt: Date.now() - 1, passwordVersion: password.version });
  await f.storage.put('session:old-password', { expiresAt: Date.now() + 999999, passwordVersion: 'older' });
  for (let i = 0; i < 2000; i++) await f.storage.put(`session:${String(i).padStart(64, '0')}`, { email: EMAIL, expiresAt: Date.now() + 999999, passwordVersion: password.version, createdAt: i });
  // Explicitly clean once to test capped storage even with corrupt legacy excess records.
  await f.object.cleanSessions(password.version, Date.now());
  await f.login();
  assert.ok((await f.storage.list({ prefix: 'session:' })).size <= 2000);
});

test('uploads are private, metadata is clean, and authenticated downloads preserve document bytes', async () => {
  const f = fixture(); await f.configure(); const bytes = crypto.getRandomValues(new Uint8Array(65536));
  const doc = await uploaded(f, uploadForm({ bytes, filename: 'field-risk.pdf', category: 'risk-assessment' }));
  assert.equal(doc.size, bytes.length); assert.equal(doc.uploadedBy, 'entomology-hau'); assert.equal(Object.hasOwn(doc, 'chunks'), false);
  assert.equal((await f.send('/documents')).status, 401);
  assert.equal((await f.send(`/documents/${doc.id}/download`)).status, 401);
  const session = await f.login();
  const list = await (await f.send('/documents', { headers: session.headers })).json(); assert.equal(list.documents[0].id, doc.id);
  const download = await f.send(`/documents/${doc.id}/download`, { headers: session.headers });
  assert.equal(download.status, 200); assert.equal(download.headers.get('Cache-Control'), 'no-store');
  assert.equal(download.headers.get('Content-Type'), 'application/octet-stream'); assert.match(download.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(download.headers.get('X-Content-Type-Options'), 'nosniff'); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
});

test('large document uploads and downloads use safe chunk and key batch sizes', async () => {
  const f = fixture(); await f.configure(); const bytes = new Uint8Array(10 * 1024 * 1024); bytes[0] = 51; bytes[bytes.length - 1] = 89;
  const doc = await uploaded(f, uploadForm({ bytes }));
  assert.equal((await f.storage.list({ prefix: `file:${doc.id}:` })).size, 160);
  const session = await f.login(); const response = await f.send(`/documents/${doc.id}/download`, { headers: session.headers });
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  const removed = await f.send(`/admin/documents/${doc.id}`, { admin: true, method: 'DELETE' }); assert.equal(removed.status, 200);
  assert.equal((await f.storage.list({ prefix: `file:${doc.id}:` })).size, 0);
});

test('a storage error rolls back the entire document upload', async () => {
  const f = fixture(); f.storage.failOn = 'document:';
  const response = await f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm({ bytes: new Uint8Array(130000) }) });
  assert.equal(response.status, 503);
  assert.equal((await f.storage.list({ prefix: 'file:' })).size, 0); assert.equal((await f.storage.list({ prefix: 'document:' })).size, 0);
});

test('document deletion removes metadata and bytes and old download URLs fail', async () => {
  const f = fixture(); await f.configure(); const doc = await uploaded(f); const session = await f.login();
  assert.equal((await f.send(`/admin/documents/${doc.id}`, { method: 'DELETE', admin: true })).status, 200);
  assert.equal((await f.send(`/documents/${doc.id}/download`, { headers: session.headers })).status, 404);
  assert.equal((await (await f.send('/admin/state', { admin: true })).json()).storageBytes, 0);
});

test('student sessions cannot upload, remove or administer research resources', async () => {
  const f = fixture(); await f.configure(); const session = await f.login();
  for (const [path, method, body] of [['/admin/state', 'GET'], ['/admin/users', 'POST', { email: 'intruder@example.org' }], ['/admin/password', 'PUT', { password: PASSWORD, expiresAt: future() }], ['/admin/documents', 'POST', uploadForm()]]) {
    assert.equal((await f.send(path, { method, body, headers: session.headers })).status, 403);
  }
});

test('file validation rejects active HTML, macros, oversized and empty files', async () => {
  const f = fixture();
  for (const [filename, bytes, expected] of [['active.html', '<script>bad</script>', 400], ['macro.docm', 'bad', 400], ['file.js', 'bad', 400], ['empty.pdf', '', 413], ['big.pdf', new Uint8Array(10 * 1024 * 1024 + 1), 413]]) {
    assert.equal((await f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm({ filename, bytes }) })).status, expected);
  }
});

test('document fields are validated including categories, dates, lengths and header-safe filenames', async () => {
  const f = fixture();
  const invalid = [{ category: 'other' }, { title: '' }, { title: 'x'.repeat(161) }, { description: 'x'.repeat(2001) }, { version: 'x'.repeat(41) }, { reviewDate: '2026-02-30' }, { filename: 'x'.repeat(180) + '.pdf' }];
  for (const input of invalid) assert.equal((await f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm(input) })).status, 400);
  const doc = await uploaded(f, uploadForm({ filename: 'biodiversité.pdf', reviewDate: '' })); assert.equal(doc.reviewDate, '');
});

test('document count and total byte limits fail before creating any file chunks', async () => {
  const f = fixture();
  for (let i = 0; i < 500; i++) await f.storage.put(`document:${i}`, { id: String(i), uploadedAt: new Date().toISOString(), size: 1 });
  assert.equal((await f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm() })).status, 409);
  f.storage.data.clear(); await f.storage.put('document:full', { id: 'full', uploadedAt: new Date().toISOString(), size: 100 * 1024 * 1024 });
  assert.equal((await f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm() })).status, 409);
  assert.equal((await f.storage.list({ prefix: 'file:' })).size, 0);
});

test('concurrent uploads are serialised and preserve both metadata records', async () => {
  const f = fixture();
  const responses = await Promise.all([f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm({ title: 'First' }) }), f.send('/admin/documents', { method: 'POST', admin: true, body: uploadForm({ title: 'Second' }) })]);
  assert.deepEqual(responses.map(x => x.status), [201, 201]);
  const state = await (await f.send('/admin/state', { admin: true })).json(); assert.equal(state.documents.length, 2);
});

test('body limits use actual streamed bytes as well as declared Content-Length', async () => {
  const f = fixture();
  const response = await f.send('/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' }, body: 'x'.repeat(8193) });
  assert.equal(response.status, 413); assert.equal(f.calls.length, 0);
  const declared = await f.send('/login', { method: 'POST', headers: { 'Content-Length': '9999999' }, body: '{}' });
  assert.equal(declared.status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4096)); controller.enqueue(new Uint8Array(4097)); controller.close(); } });
  assert.equal((await f.send('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream })).status, 413);
});

test('malformed JSON and content types are rejected without exposing internals', async () => {
  const f = fixture();
  assert.equal((await f.send('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await f.send('/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await f.send('/login', { method: 'POST', body: [] })).status, 400);
});

test('missing storage binding and unexpected storage errors fail closed', async () => {
  const f = fixture();
  assert.equal((await handleResearch(new Request(`${ORIGIN}/research-api/session`), {})).status, 503);
  const session = `__Host-hau_research=${'a'.repeat(43)}`;
  f.storage.get = async () => { throw new Error('private backend detail'); };
  const response = await f.send('/session', { headers: { Cookie: session } });
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('private backend detail'), false);
});

test('unknown routes, methods and duplicate or malformed cookies never grant access', async () => {
  const f = fixture(); await f.configure(); const session = await f.login();
  assert.equal((await f.send('/internal')).status, 404); assert.equal((await f.send('/documents', { method: 'POST' })).status, 404);
  for (const Cookie of ['__Host-hau_research=bad', `${session.cookie}; ${session.cookie}`, '__Host-hau_research=' + 'x'.repeat(5000)]) assert.equal((await f.send('/session', { headers: { Cookie } })).status, 401);
  assert.equal((await f.send('/admin/unknown', { admin: true })).status, 404);
});

test('GitHub administrators can verify uploaded downloads without a student session', async () => {
  const f = fixture(), bytes = 'Administrator upload verification';
  const doc = await uploaded(f, uploadForm({ bytes }));
  const path = `/admin/documents/${doc.id}/download`;
  assert.equal((await f.send(path)).status, 403);
  assert.equal((await f.send(path, { headers: { 'X-Hau-Research-Admin': 'entomology-hau' } })).status, 403);
  const response = await f.send(path, { admin: true });
  assert.equal(response.status, 200); assert.equal(await response.text(), bytes);
  assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal((await f.send(`/documents/${doc.id}/download`)).status, 401);
});

test('expected access failures resolve inside the concurrency gate without resetting the Durable Object', async () => {
  const f = fixture(); let rejected = false;
  f.object.ctx.blockConcurrencyWhile = async callback => {
    try { return await callback(); } catch (error) { rejected = true; throw error; }
  };
  assert.equal((await f.send('/session')).status, 401);
  assert.equal((await f.send('/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })).status, 401);
  assert.equal((await f.send('/admin/unknown', { admin: true })).status, 404);
  assert.equal(rejected, false);
});
