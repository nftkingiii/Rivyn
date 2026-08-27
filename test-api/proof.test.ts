import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers';
import { findMatchingApproval, ProofRequestSchema } from '../src/proof.js';

const abi = new Interface([
  'event InvoiceApproved(bytes32 indexed invoiceId,address indexed buyer,address indexed payee,uint256 amount)',
]);
const source = '0x1111111111111111111111111111111111111111';
const request = ProofRequestSchema.parse({
  txHash: `0x${'ab'.repeat(32)}`,
  invoiceId: `0x${'12'.repeat(32)}`,
  buyer: '0x2222222222222222222222222222222222222222',
  payee: '0x3333333333333333333333333333333333333333',
  amount: '1000000000000000000',
});

function approvalLog(overrides: Partial<typeof request> = {}, address = source) {
  const values = { ...request, ...overrides };
  const event = abi.getEvent('InvoiceApproved')!;
  const encoded = abi.encodeEventLog(event, [values.invoiceId, values.buyer, values.payee, BigInt(values.amount)]);
  return { address, topics: encoded.topics, data: encoded.data };
}

test('matches only the configured source and exact invoice terms', () => {
  assert.equal(findMatchingApproval([approvalLog()], source, request), true);
  assert.equal(findMatchingApproval([approvalLog({}, '0x4444444444444444444444444444444444444444')], source, request), false);
  assert.equal(findMatchingApproval([approvalLog({ amount: '2' })], source, request), false);
  assert.equal(findMatchingApproval([approvalLog({ buyer: '0x5555555555555555555555555555555555555555' })], source, request), false);
});

test('rejects unknown fields and unsafe numeric formats', () => {
  assert.equal(ProofRequestSchema.safeParse({ ...request, amount: '1e18' }).success, false);
  assert.equal(ProofRequestSchema.safeParse({ ...request, extra: true }).success, false);
});
