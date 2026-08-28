/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key. Unset in dev/test — telemetry is inert. */
  readonly VITE_POSTHOG_KEY?: string;
  /** Same-origin PostHog reverse-proxy path (see vercel.json). Defaults to `/ingest`. */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
