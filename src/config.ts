import { getAddress, isAddress } from 'ethers';
import { z } from 'zod';

const Url = z.string().url().refine((value) => value.startsWith('https://'), 'HTTPS URL required');

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ALLOWED_ORIGINS: z.string().min(1),
  SEPOLIA_RPC_URL: Url,
  CREDITCOIN_RPC_URL: Url,
  PROOF_BUILDER_URL: Url,
  SOURCE_APPROVAL_CONTRACT: z.string()
    .refine(isAddress, 'Valid source contract address required')
    .refine((value) => !/^0x0{40}$/i.test(value), 'Deployed source contract address required'),
});

export type AppConfig = {
  port: number;
  allowedOrigins: Set<string>;
  sepoliaRpcUrl: string;
  creditcoinRpcUrl: string;
  proofBuilderUrl: string;
  sourceApprovalContract: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.parse(environment);
  const origins = parsed.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.some((origin) => origin === '*' || !URL.canParse(origin))) {
    throw new Error('ALLOWED_ORIGINS must contain explicit valid origins');
  }
  return {
    port: parsed.PORT,
    allowedOrigins: new Set(origins),
    sepoliaRpcUrl: parsed.SEPOLIA_RPC_URL,
    creditcoinRpcUrl: parsed.CREDITCOIN_RPC_URL,
    proofBuilderUrl: parsed.PROOF_BUILDER_URL.replace(/\/$/, ''),
    sourceApprovalContract: getAddress(parsed.SOURCE_APPROVAL_CONTRACT),
  };
}
