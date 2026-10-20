// Private research documents and access records live only in this Durable Object.
// This module receives an admin identity only after worker.js verifies GitHub access.
const encoder = new TextEncoder();
const COOKIE = '__Host-hau_research';
const SESSION_MS = 8 * 60 * 60 * 1000;
const FILE_LIMIT = 10 * 1024 * 1024;
const STORAGE_LIMIT = 100 * 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;
const BODY_LIMIT = FILE_LIMIT + 64 * 1024;
const MAX_USERS = 1000;
const MAX_DOCUMENTS = 500;
const MAX_SESSIONS = 2000;
const PBKDF2_ITERATIONS = 100000;
const RATE_MS = 15 * 60 * 1000;
const RATE_PER_IP = 20;
const RATE_GLOBAL = 200;
const CATEGORIES = new Set(['risk-assessment', 'protocol', 'sop']);
const EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv']);
const SECURITY = {
  'Cache-Control': 'no-store', 'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
class ResearchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function reply(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function failure(error) {
  return reply({ error: error instanceof ResearchError ? error.message : 'The research toolkit is unavailable. Please try again later.' }, error instanceof ResearchError ? error.status : 503);
}
function bytes64(bytes) { return btoa(Array.from(bytes, x => String.fromCharCode(x)).join('')); }
function randomToken() { return bytes64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sha(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join(''); }
async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: PBKDF2_ITERATIONS }, material, 256);
  return bytes64(new Uint8Array(bytes));
}
function sameValue(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function cookie(value, seconds = SESSION_MS / 1000) { return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`; }
function tokenFrom(request) {
  const values = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${COOKIE}=`)).map(x => x.slice(COOKIE.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : '';
}
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) throw new ResearchError(400, 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.split('@')[0].length > 64 || email.includes('..')) throw new ResearchError(400, 'Enter a valid email address.');
  return email;
}
function textField(value, name, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new ResearchError(400, `Check ${name}.`);
  const result = value.trim();
  if (required && !result) throw new ResearchError(400, `Enter ${name}.`);
  return result;
}
function validDate(value, required = false) {
  if (value === '' && !required) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ResearchError(400, 'Enter a valid date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ResearchError(400, 'Enter a valid date.');
  return value;
}
function documentId(value) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value || '')) throw new ResearchError(404, 'Document not found.');
  return value;
}
function requireOrigin(request, origin) {
  if (request.headers.get('Origin') !== origin) throw new ResearchError(403, 'Use the research toolkit to make this change.');
}
async function boundedBody(request, limit) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > limit) throw new ResearchError(413, 'The request is too large.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ResearchError(413, 'The request is too large.'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
async function jsonBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ResearchError(415, 'Use a JSON request.');
  let value;
  try { value = await request.json(); } catch { throw new ResearchError(400, 'Check the submitted information.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResearchError(400, 'Check the submitted information.');
  return value;
}
function publicDocument(value) {
  const { id, title, category, description, filename, size, uploadedAt, uploadedBy, version, reviewDate } = value;
  return { id, title, category, description, filename, size, uploadedAt, uploadedBy, version, reviewDate };
}
function attachmentName(filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, x => `%${x.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
async function deleteKeys(storage, keys) { for (let i = 0; i < keys.length; i += 128) await storage.delete(keys.slice(i, i + 128)); }

// Public entry point. Client-supplied internal actor headers are never forwarded.
export async function handleResearch(request, env, { admin } = {}) {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/research-api/')) throw new ResearchError(404, 'Not found.');
    if (url.protocol !== 'https:' || !env.RESEARCH_LIBRARY) throw new ResearchError(503, 'The research toolkit is not configured yet.');
    const isAdmin = path.startsWith('/research-api/admin/');
    const actor = admin && typeof admin.login === 'string' && /^[a-zA-Z0-9-]{1,39}$/.test(admin.login) ? admin.login : '';
    if (isAdmin && !actor) throw new ResearchError(403, 'Administrator sign-in is required.');
    const mutating = !['GET', 'HEAD'].includes(request.method);
    if (mutating) requireOrigin(request, url.origin);
    const headers = new Headers({ 'X-Hau-Research-Origin': url.origin });
    for (const key of ['Content-Type', 'Cookie', 'Origin', 'X-CSRF-Token']) if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    // Cloudflare sets CF-Connecting-IP at its edge. Raw addresses are never persisted.
    headers.set('X-Hau-Research-IP', request.headers.get('CF-Connecting-IP') || 'unknown');
    if (isAdmin) headers.set('X-Hau-Research-Admin', actor);
    const body = mutating ? await boundedBody(request, path === '/research-api/admin/documents' && request.method === 'POST' ? BODY_LIMIT : 8192) : undefined;
    const internal = new Request(`https://research.internal${path}`, { method: request.method, headers, ...(body ? { body } : {}) });
    const id = env.RESEARCH_LIBRARY.idFromName('hau-research-v1');
    return await env.RESEARCH_LIBRARY.get(id).fetch(internal);
  } catch (error) { return failure(error); }
}

export class ResearchLibrary {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.storage = ctx.storage; }
  async fetch(request) {
    try {
      // Outer Worker has already bounded and fully read uploads before this gate.
      return await this.ctx.blockConcurrencyWhile(async () => {
        try { return await this.dispatch(request); }
        catch (error) { return failure(error); }
      });
    } catch (error) { return failure(error); }
  }
  async documents() {
    return [...(await this.storage.list({ prefix: 'document:', limit: MAX_DOCUMENTS + 1 })).values()]
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id));
  }
  async throttle(request, now) {
    const stored = await this.storage.get('login-rates');
    const rates = stored && now - stored.startedAt < RATE_MS && now >= stored.startedAt ? stored : { startedAt: now, total: 0, ips: {} };
    const key = await sha(`${this.env.SESSION_SECRET || 'research-rate'}:${request.headers.get('X-Hau-Research-IP') || 'unknown'}`);
    if (rates.total >= RATE_GLOBAL || (rates.ips[key] || 0) >= RATE_PER_IP) throw new ResearchError(429, 'Too many sign-in attempts. Please try again in 15 minutes.');
    rates.total++; rates.ips[key] = (rates.ips[key] || 0) + 1;
    await this.storage.put('login-rates', rates);
  }
  async getSession(request, now = Date.now()) {
    const token = tokenFrom(request);
    if (!token) throw new ResearchError(401, 'Sign in to access the research toolkit.');
    const key = `session:${await sha(token)}`;
    const value = await this.storage.get(key);
    const password = await this.storage.get('password');
    const user = value && await this.storage.get(`user:${value.email}`);
    if (!value || !password || !user || value.expiresAt <= now || password.expiresAt <= now || value.passwordVersion !== password.version || value.userVersion !== user.version) {
      if (value) await this.storage.delete(key);
      throw new ResearchError(401, 'Sign in to access the research toolkit.');
    }
    return { value, key, password };
  }
  async cleanSessions(passwordVersion, now) {
    const sessions = await this.storage.list({ prefix: 'session:', limit: MAX_SESSIONS + 1 });
    const remove = [...sessions].filter(([, s]) => s.expiresAt <= now || s.passwordVersion !== passwordVersion).map(([key]) => key);
    const live = [...sessions].filter(([key]) => !remove.includes(key)).sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (live.length >= MAX_SESSIONS) remove.push(live.shift()[0]);
    await deleteKeys(this.storage, remove);
  }
  async login(request, now) {
    await this.throttle(request, now);
    const input = await jsonBody(request);
    let email = ''; try { email = emailAddress(input.email); } catch {}
    const supplied = typeof input.password === 'string' && input.password.length >= 16 && input.password.length <= 256 ? input.password : '';
    const password = await this.storage.get('password');
    const user = email && await this.storage.get(`user:${email}`);
    // Derive for unknown emails as well; never disclose allowlist membership.
    const salt = password?.salt || bytes64(new Uint8Array(32));
    const hash = await passwordHash(supplied || 'invalid-sign-in-value', salt);
    if (!password || !user || !supplied || password.expiresAt <= now || !sameValue(hash, password.hash)) throw new ResearchError(401, 'The email address or shared password is incorrect, or access has expired.');
    await this.cleanSessions(password.version, now);
    const token = randomToken(), csrf = randomToken();
    const expiresAt = Math.min(now + SESSION_MS, password.expiresAt);
    await this.storage.put(`session:${await sha(token)}`, { email, userVersion: user.version, passwordVersion: password.version, csrf, createdAt: now, expiresAt });
    return reply({ user: { email }, csrfToken: csrf, passwordExpiresAt: new Date(password.expiresAt).toISOString() }, 200, { 'Set-Cookie': cookie(token, Math.max(0, Math.floor((expiresAt - now) / 1000))) });
  }
  async dispatch(request) {
    const path = new URL(request.url).pathname, method = request.method, now = Date.now();
    const origin = request.headers.get('X-Hau-Research-Origin');
    if (!origin || !/^https:\/\//.test(origin)) throw new ResearchError(403, 'Access denied.');
    if (!['GET', 'HEAD'].includes(method)) requireOrigin(request, origin);
    const admin = request.headers.get('X-Hau-Research-Admin');
    if (path.startsWith('/research-api/admin/')) {
      if (!admin || !/^[a-zA-Z0-9-]{1,39}$/.test(admin)) throw new ResearchError(403, 'Administrator sign-in is required.');
      return await this.admin(request, path, admin, now);
    }
    if (path === '/research-api/login' && method === 'POST') return await this.login(request, now);
    if (path === '/research-api/logout' && method === 'POST') {
      let current;
      try { current = await this.getSession(request, now); } catch (error) { if (!(error instanceof ResearchError) || error.status !== 401) throw error; }
      if (current) {
        if (!sameValue(request.headers.get('X-CSRF-Token'), current.value.csrf)) throw new ResearchError(403, 'Reload the toolkit before signing out.');
        await this.storage.delete(current.key);
      }
      return reply({ signedOut: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    const download = path.match(/^\/research-api\/documents\/([^/]+)\/download$/);
    if (!(method === 'GET' && (path === '/research-api/session' || path === '/research-api/documents' || download))) throw new ResearchError(404, 'Not found.');
    const current = await this.getSession(request, now);
    if (path === '/research-api/session') return reply({ user: { email: current.value.email }, csrfToken: current.value.csrf, passwordExpiresAt: new Date(current.password.expiresAt).toISOString() });
    if (path === '/research-api/documents') return reply({ documents: (await this.documents()).map(publicDocument), passwordExpiresAt: new Date(current.password.expiresAt).toISOString() });
    return await this.download(download[1]);
  }
  async download(value) {
    const id = documentId(value), doc = await this.storage.get(`document:${id}`);
    if (!doc) throw new ResearchError(404, 'Document not found.');
    const body = new Uint8Array(doc.size); let offset = 0;
    for (let start = 0; start < doc.chunks; start += 128) {
      const keys = Array.from({ length: Math.min(128, doc.chunks - start) }, (_, i) => `file:${id}:${start + i}`);
      const parts = await this.storage.get(keys);
      for (const key of keys) {
        const value = parts.get(key);
        if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) throw new Error('Missing document chunk');
        const chunk = new Uint8Array(value);
        if (offset + chunk.length > body.length) throw new Error('Invalid document chunk');
        body.set(chunk, offset); offset += chunk.length;
      }
    }
    if (offset !== body.length) throw new Error('Incomplete document');
    return new Response(body, { headers: { ...SECURITY, 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length), 'Content-Disposition': attachmentName(doc.filename) } });
  }
  async admin(request, path, actor, now) {
    const method = request.method;
    if (path === '/research-api/admin/state' && method === 'GET') {
      const users = [...(await this.storage.list({ prefix: 'user:', limit: MAX_USERS + 1 })).values()].map(({ email, addedAt }) => ({ email, addedAt }));
      const password = await this.storage.get('password'), documents = await this.documents();
      return reply({ users, password: { configured: Boolean(password), expiresAt: password ? new Date(password.expiresAt).toISOString() : null, changedAt: password?.changedAt || null }, documents: documents.map(publicDocument), storageBytes: documents.reduce((total, doc) => total + doc.size, 0), maxStorageBytes: STORAGE_LIMIT });
    }
    if (path === '/research-api/admin/users' && ['POST', 'DELETE'].includes(method)) {
      const input = await jsonBody(request), email = emailAddress(input.email), key = `user:${email}`;
      if (method === 'DELETE') { await this.storage.delete(key); return reply({ removed: true }); }
      if (!await this.storage.get(key)) {
        const users = await this.storage.list({ prefix: 'user:', limit: MAX_USERS });
        if (users.size >= MAX_USERS) throw new ResearchError(409, 'The email list has reached its limit of 1,000 addresses.');
        await this.storage.put(key, { email, addedAt: new Date(now).toISOString(), version: crypto.randomUUID() });
      }
      return reply({ added: true });
    }
    if (path === '/research-api/admin/password' && method === 'PUT') {
      const input = await jsonBody(request), password = input.password;
      if (typeof password !== 'string' || password.length < 16 || password.length > 256 || !password.trim()) throw new ResearchError(400, 'Use a shared password of 16–256 characters.');
      const date = validDate(input.expiresAt, true), expiresAt = Date.parse(`${date}T23:59:59.999Z`);
      if (expiresAt <= now || expiresAt > now + 366 * 86400000) throw new ResearchError(400, 'Choose a future expiry date within the next 366 days.');
      const existing = await this.storage.get('password');
      if (existing && sameValue(await passwordHash(password, existing.salt), existing.hash)) throw new ResearchError(400, 'Choose a different password for the new access period.');
      const salt = bytes64(crypto.getRandomValues(new Uint8Array(32)));
      const value = { salt, hash: await passwordHash(password, salt), iterations: PBKDF2_ITERATIONS, expiresAt, changedAt: new Date(now).toISOString(), version: crypto.randomUUID() };
      await this.storage.put('password', value);
      return reply({ saved: true, expiresAt: new Date(expiresAt).toISOString() });
    }
    if (path === '/research-api/admin/documents' && method === 'POST') return await this.upload(request, actor, now);
    const download = path.match(/^\/research-api\/admin\/documents\/([^/]+)\/download$/);
    if (download && method === 'GET') return await this.download(download[1]);
    const remove = path.match(/^\/research-api\/admin\/documents\/([^/]+)$/);
    if (remove && method === 'DELETE') {
      const id = documentId(remove[1]), documents = await this.documents(), doc = documents.find(x => x.id === id);
      if (!doc) throw new ResearchError(404, 'Document not found.');
      await this.storage.transaction(async tx => {
        await deleteKeys(tx, Array.from({ length: doc.chunks }, (_, i) => `file:${id}:${i}`));
        await tx.delete(`document:${id}`);
      });
      return reply({ removed: true });
    }
    throw new ResearchError(404, 'Not found.');
  }
  async upload(request, actor, now) {
    if (!/^multipart\/form-data(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ResearchError(415, 'Choose a document to upload.');
    let form;
    try { form = await request.formData(); } catch { throw new ResearchError(400, 'The upload could not be read.'); }
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new ResearchError(400, 'Choose a document to upload.');
    if (!file.size || file.size > FILE_LIMIT) throw new ResearchError(413, 'Choose a document between 1 byte and 10 MiB.');
    const filename = textField(file.name, 'the filename', 180, true);
    if (/[\\/\r\n]/.test(filename) || !EXTENSIONS.has(filename.split('.').pop().toLowerCase())) throw new ResearchError(400, 'Use a PDF, Word, Excel, TXT or CSV file.');
    const title = textField(form.get('title'), 'a document title', 160, true);
    const category = form.get('category'); if (!CATEGORIES.has(category)) throw new ResearchError(400, 'Choose a document category.');
    const description = textField(form.get('description') ?? '', 'the description', 2000);
    const version = textField(form.get('version') ?? '', 'the version', 40);
    const reviewDate = validDate(form.get('reviewDate') ?? '');
    const documents = await this.documents();
    if (documents.length >= MAX_DOCUMENTS) throw new ResearchError(409, 'The toolkit has reached its limit of 500 documents.');
    if (documents.reduce((sum, doc) => sum + doc.size, 0) + file.size > STORAGE_LIMIT) throw new ResearchError(409, 'The toolkit storage limit has been reached. Remove an old document before uploading.');
    const bytes = new Uint8Array(await file.arrayBuffer()), id = crypto.randomUUID();
    const doc = { id, title, category, description, filename, size: bytes.length, uploadedAt: new Date(now).toISOString(), uploadedBy: actor, version, reviewDate, chunks: Math.ceil(bytes.length / CHUNK_SIZE) };
    await this.storage.transaction(async tx => {
      for (let start = 0; start < doc.chunks; start += 128) {
        const entries = {};
        for (let i = start; i < Math.min(doc.chunks, start + 128); i++) entries[`file:${id}:${i}`] = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).buffer;
        await tx.put(entries);
      }
      await tx.put(`document:${id}`, doc);
    });
    return reply({ uploaded: true, document: publicDocument(doc) }, 201);
  }
}
