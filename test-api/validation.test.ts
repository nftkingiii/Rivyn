import assert from 'node:assert/strict';
import test from 'node:test';
import {
  randomInvoiceId,
  shortAddress,
  validateAddress,
  validateAmount,
  validateBytes32,
  validateTxHash,
} from '../web/src/validation.js';

const bytes32 = `0x${'ab'.repeat(32)}`;
const address = '0x0000000000000000000000000000000000000001';

test('accepts canonical settlement identifiers and rejects malformed values', () => {
  assert.equal(validateBytes32(bytes32), '');
  assert.notEqual(validateBytes32('0x1234'), '');
  assert.equal(validateTxHash(bytes32), '');
  assert.notEqual(validateTxHash('not-a-hash'), '');
});

test('rejects invalid, zero, and non-positive settlement inputs', () => {
  assert.equal(validateAddress(address, 'Buyer'), '');
  assert.match(validateAddress('0x0000000000000000000000000000000000000000', 'Buyer'), /zero address/);
  assert.match(validateAddress('invalid', 'Payee'), /valid payee/);
  assert.equal(validateAmount('0.25'), '');
  assert.match(validateAmount('0'), /greater than zero/);
  assert.match(validateAmount('1e5'), /valid decimal/);
});

test('generates unique bytes32 invoice identifiers and shortens addresses', () => {
  const first = randomInvoiceId();
  const second = randomInvoiceId();
  assert.equal(validateBytes32(first), '');
  assert.equal(validateBytes32(second), '');
  assert.notEqual(first, second);
  assert.equal(shortAddress(address), '0x0000…0001');
});
