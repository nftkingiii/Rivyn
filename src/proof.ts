import { Interface, JsonRpcProvider, getAddress } from 'ethers';
import { proofProvider } from '@gluwa/usc-sdk';
import { z } from 'zod';
import type { AppConfig } from './config.js';

export const ProofRequestSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  invoiceId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  buyer: z.string().refine((value) => {
    try { getAddress(value); return true; } catch { return false; }
  }),
  payee: z.string().refine((value) => {
    try { getAddress(value); return true; } catch { return false; }
  }),
  amount: z.string().regex(/^[1-9][0-9]*$/).refine((value) => {
    try { return BigInt(value) <= (1n << 128n) - 1n; }
    catch { return false; }
  }),
}).strict();

const approvalInterface = new Interface([
  'event InvoiceApproved(bytes32 indexed invoiceId,address indexed buyer,address indexed payee,uint256 amount)',
]);

export class ProofError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) {
    super(message);
  }
}

export type ProofRequest = z.infer<typeof ProofRequestSchema>;

export function findMatchingApproval(
  logs: ReadonlyArray<{ address: string; topics: ReadonlyArray<string>; data: string }>,
  sourceContract: string,
  request: ProofRequest,
): boolean {
  return logs.some((log) => {
    if (getAddress(log.address) !== sourceContract) return false;
    try {
      const event = approvalInterface.parseLog({ topics: [...log.topics], data: log.data });
      return event?.name === 'InvoiceApproved'
        && event.args.invoiceId.toLowerCase() === request.invoiceId.toLowerCase()
        && getAddress(event.args.buyer) === getAddress(request.buyer)
        && getAddress(event.args.payee) === getAddress(request.payee)
        && event.args.amount === BigInt(request.amount);
    } catch {
      return false;
    }
  });
}

export class ProofService {
  private readonly sourceProvider: JsonRpcProvider;
  private readonly creditcoinProvider: JsonRpcProvider;
  private readonly builder: proofProvider.service.ProofBuilder;

  constructor(private readonly config: AppConfig) {
    this.sourceProvider = new JsonRpcProvider(config.sepoliaRpcUrl, 11155111, { staticNetwork: true });
    this.creditcoinProvider = new JsonRpcProvider(config.creditcoinRpcUrl);
    this.builder = new proofProvider.service.ProofBuilder(1, config.proofBuilderUrl, 10_000);
  }

  async build(request: ProofRequest) {
    const [sourceNetwork, creditcoinNetwork, receipt] = await Promise.all([
      this.sourceProvider.getNetwork(),
      this.creditcoinProvider.getNetwork(),
      this.sourceProvider.getTransactionReceipt(request.txHash),
    ]);
    if (sourceNetwork.chainId !== 11155111n) throw new ProofError('WRONG_SOURCE_NETWORK', 'Source RPC is not Sepolia', 503);
    if (creditcoinNetwork.chainId !== 102031n) throw new ProofError('WRONG_CREDITCOIN_NETWORK', 'Creditcoin RPC is not CC3 Testnet', 503);
    if (!receipt) {
      throw new ProofError('TRANSACTION_NOT_MINED', 'Transaction is missing or not mined', 404);
    }
    if (receipt.status !== 1) throw new ProofError('TRANSACTION_FAILED', 'Source transaction failed');
    if (!findMatchingApproval(receipt.logs, this.config.sourceApprovalContract, request)) {
      throw new ProofError('APPROVAL_MISMATCH', 'Transaction does not contain the expected Rivyn approval');
    }

    let result;
    try {
      result = await this.builder.getProof(request.txHash);
    } catch {
      throw new ProofError('PROOF_NOT_READY', 'The source block is not attested yet; retry shortly', 409);
    }
    if (!result.success || !result.data) {
      throw new ProofError('PROOF_NOT_READY', 'The source block is not attested yet; retry shortly', 409);
    }

    const proof = result.data;
    return {
      source: {
        chainId: sourceNetwork.chainId.toString(),
        transactionHash: request.txHash,
        blockNumber: receipt.blockNumber,
        sourceContract: this.config.sourceApprovalContract,
      },
      releaseCall: {
        invoiceId: request.invoiceId,
        chainKey: proof.chainKey,
        blockHeight: proof.headerNumber,
        encodedTransaction: proof.txBytes,
        merkleRoot: proof.merkleProof.root,
        siblings: proof.merkleProof.siblings,
        lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
        continuityRoots: proof.continuityProof.roots,
      },
    };
  }
}
