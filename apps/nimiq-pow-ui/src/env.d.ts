/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAUCET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
