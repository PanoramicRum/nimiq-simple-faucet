/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The faucet URL the browser hits. Must be CORS-allowed by the faucet
   *  (FAUCET_CORS_ORIGINS). For the compose stack that's http://localhost:8080. */
  readonly VITE_FAUCET_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
