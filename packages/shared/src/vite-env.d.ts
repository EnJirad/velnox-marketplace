/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API base URL (e.g. http://localhost:3001 or https://velnox-api.onrender.com) */
  readonly VITE_API_URL?: string;

  /** Sub-path basename when the app is deployed behind a gateway (e.g. "/center") */
  readonly VITE_SITE_BASENAME?: string;

  /** Full URL of the VelShop frontend (e.g. https://shop.velnox.com) */
  readonly VITE_VELSHOP_URL?: string;

  /** Full URL of the VelSeller frontend (e.g. https://seller.velnox.com) */
  readonly VITE_VELSELLER_URL?: string;

  /** Full URL of the VelCenter frontend (e.g. https://center.velnox.com) */
  readonly VITE_VELCENTER_URL?: string;

  /** Full URL of the Velnox corporate website (e.g. https://velnox.com) */
  readonly VITE_CORPORATE_URL?: string;

  /** Sentry DSN for error monitoring (optional) */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
