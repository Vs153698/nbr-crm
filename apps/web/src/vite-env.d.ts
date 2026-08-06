/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin the API is served from, e.g. `https://api.example.in`.
   *
   * Leave unset to call the API on the same origin as this app, which is the
   * simplest deployment and what the Vite dev proxy provides locally. Set it
   * only when the API lives on a different host — see the note in
   * `lib/api-client.ts` for the cookie and CORS settings that must accompany it.
   *
   * Baked in at build time, so changing it needs a rebuild, not a restart.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
