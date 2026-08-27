export type ChainConfig = {
  id: number;
  hexId: `0x${string}`;
  name: string;
  shortName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  explorer: string;
};

export const SEPOLIA: ChainConfig = {
  id: 11155111,
  hexId: '0xaa36a7',
  name: 'Ethereum Sepolia',
  shortName: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  explorer: 'https://sepolia.etherscan.io',
};

export const CREDITCOIN: ChainConfig = {
  id: 102031,
  hexId: '0x18e8f',
  name: 'Creditcoin Testnet',
  shortName: 'CC3 Testnet',
  nativeCurrency: { name: 'Testnet Creditcoin', symbol: 'tCTC', decimals: 18 },
  rpcUrls: ['https://rpc.cc3-testnet.creditcoin.network/'],
  explorer: 'https://creditcoin-testnet.blockscout.com',
};

export const SOURCE_APPROVAL_ABI = [
  'function approveInvoice(bytes32 invoiceId,address payee,uint256 amount)',
] as const;

export const ESCROW_ABI = [
  'function fundInvoice(bytes32 invoiceId,address buyer,address payee,uint64 expiresAt) payable',
  'function releaseWithProof(bytes32 invoiceId,uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,tuple(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots) returns (bytes32 queryId)',
  'function refundExpired(bytes32 invoiceId)',
] as const;
