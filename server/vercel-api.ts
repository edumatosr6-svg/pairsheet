import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client/web';
import { z } from 'zod';
import { act } from '../lib/actions';
import { blankState, type State } from '../lib/domain';

const scrypt = promisify(scryptCallback);
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const setupToken = process.env.SETUP_TOKEN ?? '';
if (!url || !authToken) throw Error('Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN na Vercel.');
if (setupToken.length < 24) throw Error('Configure SETUP_TOKEN com pelo menos 24 caracteres aleatórios.');
// A file URL is used only for local integration tests; production uses Turso over HTTP.
const db = url.startsWith('file:')
  ? (await import('@libsql/client')).createClient({ url })
  : createClient({ url, authToken });
export function closeDatabaseForTests() { db.close(); }
const schema = [
  "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','viewer')),password_hash TEXT NOT NULL)",
  'CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS workspace(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,message TEXT NOT NULL,at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)',
];
let ready: Promise<void> | undefined;
function initialize() {
  ready ??= (async () => {
    for (const sql of schema) await db.execute(sql);
    await db.execute({ sql: 'INSERT OR IGNORE INTO workspace(id,data) VALUES (?,?)', args: ['simas', JSON.stringify(blankState())] });
  })().catch(e => { ready = undefined; throw e; });
  return ready;
}
type User = { id: string; email: string; name: string; role: 'admin' | 'viewer' };
const fields = 'id,email,name,role';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const credentials = z.object({ email: z.string().trim().email().max(200).transform(x => x.toLowerCase()), password: z.string().min(12).max(128) });
async function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return salt + ':' + (await scrypt(password, salt, 64) as Buffer).toString('hex'); }
async function passwordMatches(password: string, stored: string) { const [salt, value] = stored.split(':'); const computed = await scrypt(password, salt, 64) as Buffer; const expected = Buffer.from(value, 'hex'); return expected.length === computed.length && timingSafeEqual(computed, expected); }
function cookies(req: IncomingMessage) { return Object.fromEntries((req.headers.cookie ?? '').split(';').map(x => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1)]; })); }
function cookie(token: string, maxAge: number) { return `simas_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; Secure`; }
function json(res: ServerResponse, status: number, data: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); res.end(JSON.stringify(data)); }
async function one<T>(sql: string, args: (string | number)[] = []) { return (await db.execute({ sql, args })).rows[0] as T | undefined; }
async function all<T>(sql: string, args: (string | number)[] = []) { return (await db.execute({ sql, args })).rows as T[]; }
async function run(sql: string, args: (string | number)[] = []) { return db.execute({ sql, args }); }
async function identity(req: IncomingMessage) { const token = cookies(req).simas_session; if (!token) return; return one<User>(`SELECT ${fields.split(',').map(x => 'u.' + x).join(',')} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?`, [hash(token), Date.now()]); }
async function session(res: ServerResponse, user: User) { const token = randomBytes(32).toString('base64url'); await run('DELETE FROM sessions WHERE expires<=?', [Date.now()]); await run('INSERT INTO sessions VALUES (?,?,?)', [hash(token), user.id, Date.now() + 12 * 60 * 60 * 1000]); res.setHeader('Set-Cookie', cookie(token, 12 * 60 * 60)); }
async function readState() { return (await one<{ revision: number; data: string }>('SELECT revision,data FROM workspace WHERE id=?', ['simas']))!; }
async function snapshot(user: User) { const row = await readState(); return { state: JSON.parse(row.data), revision: row.revision, user, users: user.role === 'admin' ? await all<User>(`SELECT ${fields} FROM users ORDER BY name`) : [] }; }
async function body(req: IncomingMessage) { let size = 0; const chunks: Buffer[] = []; for await (const chunk of req) { size += chunk.length; if (size > 256_000) throw Error('Envie menos informações por vez.'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
async function allowedAttempt(key: string) { await run('DELETE FROM login_limits WHERE reset_at<?', [Date.now()]); const row = await one<{ attempts: number }>('SELECT attempts FROM login_limits WHERE key=?', [key]); if ((row?.attempts ?? 0) >= 10) return false; await run('INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1', [key, Date.now() + 15 * 60 * 1000]); return true; }
async function transaction<T>(fn: (tx: Awaited<ReturnType<typeof db.transaction>>) => Promise<T>) { const tx = await db.transaction('write'); try { const result = await fn(tx); await tx.commit(); return result; } catch (e) { await tx.rollback(); throw e; } }
const labels: Record<string, string> = { employee: 'Cadastro de funcionário atualizado', unavailable: 'Indisponibilidade cadastrada', 'remove-unavailable': 'Indisponibilidade removida', generate: 'Escala recalculada', fix: 'Conflitos corrigidos', publish: 'Escala publicada', rule: 'Regra de dupla atualizada', confirm: 'Presenças confirmadas', absence: 'Falta registrada', substitute: 'Funcionário substituído', kind: 'Tipo de dia alterado', demo: 'Exemplo demonstrativo carregado' };
function stateChanges(previous: State, state: State) { return ['employees', 'unavailable', 'days', 'rules', 'published'].flatMap(collection => { const key = (item: unknown) => { if (typeof item === 'string') return item; const r = item as Record<string, unknown>; return String(r.id ?? r.date ?? [r.a, r.b].sort().join('|')); }; const before = new Map((previous[collection as keyof State] as unknown[]).map(item => [key(item), item])); const after = new Map((state[collection as keyof State] as unknown[]).map(item => [key(item), item])); return [...new Set([...before.keys(), ...after.keys()])].flatMap(id => JSON.stringify(before.get(id)) === JSON.stringify(after.get(id)) ? [] : [{ collection, before: before.get(id) ?? null, after: after.get(id) ?? null }]); }); }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    await initialize();
    const origin = `https://${req.headers.host}`;
    const requestUrl = new URL(req.url ?? '/', origin);
    const route = requestUrl.searchParams.get('route');
    const path = route ? (route === 'healthz' ? '/healthz' : '/api/' + route) : requestUrl.pathname;
    if (path === '/healthz') return json(res, 200, { status: 'ok' });
    if (!path.startsWith('/api/')) return json(res, 404, { error: 'Página não encontrada.' });
    if (req.method !== 'GET' && (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json'))) return json(res, 403, { error: 'Origem não permitida.' });
    if (path === '/api/auth/status' && req.method === 'GET') return json(res, 200, { needsSetup: !await one('SELECT id FROM users LIMIT 1') });
    if (['/api/auth/login', '/api/auth/setup'].includes(path) && req.method === 'POST') {
      const input = await body(req); const parsed = credentials.parse(input);
      const peer = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
      const key = hash('email:' + parsed.email);
      if (!await allowedAttempt(key) || !await allowedAttempt(hash('ip:' + peer))) return json(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
      if (path.endsWith('/setup')) {
        if (hash(String(input.token ?? '')) !== hash(setupToken)) return json(res, 403, { error: 'Código de instalação inválido.' });
        const name = z.string().trim().min(2).max(100).parse(input.name); const password = await passwordHash(parsed.password);
        const user = await transaction(async tx => {
          if ((await tx.execute('SELECT id FROM users LIMIT 1')).rows.length) throw Error('A instalação já foi concluída. Entre com sua conta.');
          const user: User = { id: randomUUID(), email: parsed.email, name, role: 'admin' };
          await tx.execute({ sql: 'INSERT INTO users VALUES (?,?,?,?,?)', args: [user.id, user.email, user.name, user.role, password] });
          await tx.execute({ sql: 'INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)', args: [user.id, 'Administrador inicial criado', new Date().toISOString()] });
          return user;
        });
        await session(res, user); return json(res, 201, { ok: true });
      }
      const user = await one<User & { password_hash: string }>('SELECT * FROM users WHERE email=?', [parsed.email]);
      const valid = await passwordMatches(parsed.password, user?.password_hash ?? '00000000000000000000000000000000:' + '00'.repeat(64));
      if (!user || !valid) return json(res, 401, { error: 'E-mail ou senha incorretos.' });
      await run('DELETE FROM login_limits WHERE key=?', [key]); await session(res, user); return json(res, 200, { ok: true });
    }
    const user = await identity(req); if (!user) return json(res, 401, { error: 'Entre na sua conta para acessar o SIMAS.' });
    if (path === '/api/auth/logout' && req.method === 'POST') { await run('DELETE FROM sessions WHERE token_hash=?', [hash(cookies(req).simas_session ?? '')]); res.setHeader('Set-Cookie', cookie('', 0)); return json(res, 200, { ok: true }); }
    if (path === '/api/state' && req.method === 'GET') return json(res, 200, await snapshot(user));
    if (req.method !== 'POST') return json(res, 404, { error: 'Página não encontrada.' });
    if (user.role !== 'admin') return json(res, 403, { error: 'Somente administradores podem alterar a escala.' });
    if (path === '/api/users') {
      const input = await body(req); const parsed = credentials.extend({ name: z.string().trim().min(2).max(100), role: z.enum(['admin', 'viewer']) }).parse(input); const pw = await passwordHash(parsed.password);
      await transaction(async tx => {
        if ((await tx.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [parsed.email] })).rows.length) throw Error('Já existe uma conta com esse e-mail.');
        await tx.execute({ sql: 'INSERT INTO users VALUES (?,?,?,?,?)', args: [randomUUID(), parsed.email, parsed.name, parsed.role, pw] });
        await tx.execute({ sql: 'INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)', args: [user.id, 'Conta criada: ' + parsed.email, new Date().toISOString()] });
      }); return json(res, 201, await snapshot(user));
    }
    if (path === '/api/users/password') {
      const input = z.object({ id: z.string(), password: z.string().min(12).max(128) }).parse(await body(req)); const pw = await passwordHash(input.password);
      await transaction(async tx => {
        if (!(await tx.execute({ sql: 'SELECT id FROM users WHERE id=?', args: [input.id] })).rows.length) throw Error('Conta não encontrada.');
        await tx.execute({ sql: 'UPDATE users SET password_hash=? WHERE id=?', args: [pw, input.id] });
        await tx.execute({ sql: 'DELETE FROM sessions WHERE user_id=?', args: [input.id] });
        await tx.execute({ sql: 'INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)', args: [user.id, 'Senha redefinida: ' + input.id, new Date().toISOString()] });
      }); return json(res, 200, { ok: true });
    }
    if (path === '/api/state') {
      const input = z.object({ action: z.string(), revision: z.number().int() }).passthrough().parse(await body(req));
      const row = await readState(); if (row.revision !== input.revision) return json(res, 409, { error: 'Outra pessoa alterou os dados. Atualize a página antes de continuar.' });
      if (input.action === 'user-role') {
        const v = z.object({ id: z.string(), role: z.enum(['admin', 'viewer']) }).parse(input); if (v.id === user.id) throw Error('Você não pode alterar seu próprio perfil.');
        const changed = await transaction(async tx => {
          const result = await tx.execute({ sql: 'UPDATE workspace SET revision=revision+1 WHERE id=? AND revision=?', args: ['simas', row.revision] });
          if (!result.rowsAffected) return false;
          await tx.execute({ sql: 'UPDATE users SET role=? WHERE id=?', args: [v.role, v.id] });
          await tx.execute({ sql: 'INSERT INTO security_audit(actor,message,at) VALUES (?,?,?)', args: [user.id, 'Perfil alterado: ' + v.id + ' → ' + v.role, new Date().toISOString()] });
          return true;
        });
        if (!changed) return json(res, 409, { error: 'Os dados mudaram em outra sessão. Atualize a página.' });
        return json(res, 200, await snapshot(user));
      }
      const previous = JSON.parse(row.data) as State;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const state = act(previous, input, today);
      state.audit.unshift({ at: new Date().toISOString(), actor: user.name, message: `${labels[input.action] ?? input.action}${input.date ? ' · ' + input.date : ''}${input.month ? ' · ' + input.month : ''}`, changes: stateChanges(previous, state) });
      const result = await run('UPDATE workspace SET data=?,revision=revision+1 WHERE id=? AND revision=?', [JSON.stringify(state), 'simas', row.revision]);
      if (!result.rowsAffected) return json(res, 409, { error: 'Os dados mudaram em outra sessão. Atualize a página.' });
      return json(res, 200, await snapshot(user));
    }
    return json(res, 404, { error: 'Página não encontrada.' });
  } catch (e) {
    console.error(e);
    const invalid = e instanceof z.ZodError;
    const status = invalid ? 400 : 503;
    json(res, status, { error: invalid ? 'Confira os campos. Use e-mail válido e senha com pelo menos 12 caracteres.' : 'Não foi possível concluir a operação.' });
  }
}
