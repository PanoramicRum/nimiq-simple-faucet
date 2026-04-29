/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAUCET_URL: string;
  /** Identifier sent in `hostContext.uid`. In production the backend signs
   *  the hostContext; the example uses the literal value for the demo. */
  readonly VITE_INTEGRATOR_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
