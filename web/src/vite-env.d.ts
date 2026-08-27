/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROOF_API_URL?: string;
  readonly VITE_SOURCE_APPROVAL_CONTRACT?: string;
  readonly VITE_ESCROW_CONTRACT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
