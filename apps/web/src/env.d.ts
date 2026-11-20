/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the daemon. Default `http://127.0.0.1:6465`. */
  readonly VITE_DAEMON_URL?: string
  /** `1` forces the in-memory mock API. */
  readonly VITE_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
