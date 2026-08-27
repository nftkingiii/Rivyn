import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
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
}));

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
