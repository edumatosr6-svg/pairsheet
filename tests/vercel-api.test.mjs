import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';

test('Vercel API protects one access and persists schedule state', async () => {
  await mkdir('work', { recursive: true });
  const dir = await mkdtemp(resolve('work/api-test-'));
  const file = join(dir, 'simas.sqlite').replaceAll('\\', '/');
  process.env.TURSO_DATABASE_URL = 'file:' + file;
  process.env.TURSO_AUTH_TOKEN = 'local-test';
  process.env.SETUP_TOKEN = randomBytes(32).toString('hex');
  const outfile = join(dir, 'api.mjs');
  await build({ entryPoints: ['server/vercel-api.ts'], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external' });
  const { default: handler, closeDatabaseForTests } = await import(pathToFileURL(outfile).href);
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const origin = `https://127.0.0.1:${address.port}`;
  let cookie = '';
  async function request(path, method = 'GET', data) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(data ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await request('/api/auth/status')).data.needsSetup, true);
    assert.equal((await request('/api/auth/setup', 'POST', { token: process.env.SETUP_TOKEN, name: 'Admin', email: 'admin@example.com', password: '123456789012' })).status, 201);
    const initial = await request('/api/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.data.revision, 0);
    const updated = await request('/api/state', 'POST', { action: 'demo', month: '2026-09', revision: 0 });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.revision, 1);
    assert.ok(updated.data.state.employees.length > 0);
    assert.equal((await request('/api/state', 'POST', { action: 'demo', month: '2026-09', revision: 0 })).status, 409);
    assert.equal((await request('/api/auth/logout', 'POST', {})).status, 200);
    assert.equal((await request('/api/state')).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { password: '123456789012' })).status, 200);
    assert.equal((await request('/api/state')).data.revision, 1);
    assert.equal((await request('/api/users', 'POST', { name: 'Extra', email: 'extra@example.com', password: '123456789012', role: 'admin' })).status, 404);
    assert.equal((await request('/api/access/password', 'POST', { password: 'abcdefghijklmnop' })).status, 200);
    assert.equal((await request('/api/state')).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { password: 'abcdefghijklmnop' })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    closeDatabaseForTests();
    await rm(dir, { recursive: true, force: true }).catch(e => { if (e.code !== 'EBUSY') throw e; });
  }
});
