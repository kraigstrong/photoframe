/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin telemetry endpoint. Unset in dev/test — telemetry is inert. */
  readonly VITE_TELEMETRY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
