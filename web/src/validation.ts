import { getAddress, isHexString, parseEther } from 'ethers';

export function validateBytes32(value: string) {
  return isHexString(value.trim(), 32) ? '' : 'Enter a 32-byte hexadecimal invoice ID.';
}

export function validateAddress(value: string, label: string) {
  try {
    if (getAddress(value.trim()) === '0x0000000000000000000000000000000000000000') {
      return `${label} cannot be the zero address.`;
    }
    return '';
  } catch {
    return `Enter a valid ${label.toLowerCase()} address.`;
  }
}

export function validateAmount(value: string) {
  try {
    return parseEther(value.trim()) > 0n ? '' : 'Amount must be greater than zero.';
  } catch {
    return 'Enter a valid decimal amount.';
  }
}

export function validateTxHash(value: string) {
  return isHexString(value.trim(), 32) ? '' : 'Enter a 32-byte Sepolia transaction hash.';
}

export function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '';
}

export function randomInvoiceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
