import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../src/config.js';

process.env.NODE_ENV = 'test';
const { createRivynServer } = await import('../src/server.js');

const config: AppConfig = {
  port: 0,
  allowedOrigins: new Set(['https://app.rivyn.test']),
  sepoliaRpcUrl: 'https://example.com/sepolia',
  creditcoinRpcUrl: 'https://example.com/creditcoin',
  proofBuilderUrl: 'https://example.com/proofs',
  sourceApprovalContract: '0x1111111111111111111111111111111111111111',
};

async function withServer(run: (base: string) => Promise<void>) {
  const server = createRivynServer(config, { build: async () => ({ proof: true }) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('health endpoint sends hardened headers', async () => withServer(async (base) => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'rivyn',
    version: '0.1.0',
    revision: 'development',
  });
}));

test('serves the production web app with browser-safe headers', async () => {
  const webRoot = await mkdtemp(join(tmpdir(), 'rivyn-web-'));
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>Rivyn</title>');
  const server = createRivynServer(config, { build: async () => ({ proof: true }) }, webRoot);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/prove`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>Rivyn<\/title>/);
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(webRoot, { recursive: true, force: true });
  }
});

test('rejects unapproved origins and malformed proof requests', async () => withServer(async (base) => {
  const forbidden = await fetch(`${base}/v1/proofs`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}',
  });
  assert.equal(forbidden.status, 403);

  const invalid = await fetch(`${base}/v1/proofs`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.rivyn.test' }, body: '{}',
  });
  assert.equal(invalid.status, 422);
}));
