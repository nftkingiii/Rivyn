type EthereumRequest = { method: string; params?: unknown[] | Record<string, unknown> };

interface Eip1193Provider {
  request(args: EthereumRequest): Promise<unknown>;
  on?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void;
  removeListener?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void;
}

interface Window {
  ethereum?: Eip1193Provider;
}
