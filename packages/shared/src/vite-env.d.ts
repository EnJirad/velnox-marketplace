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

  /** Customer-support email shown on the Help Center (optional). */
  readonly VITE_SUPPORT_EMAIL?: string;

  /** Sentry DSN for error monitoring (optional) */
  readonly VITE_SENTRY_DSN?: string;

  /**
   * API tree this build talks to: omit or `legacy` (default) | `mvp`.
   * MVP mode is refused in production unless `VITE_DEPLOY_ENV=staging`.
   * See `packages/shared/src/mvp/config.ts`.
   */
  readonly VITE_API_MODE?: string;

  /**
   * Deployment environment used ONLY for the MVP-mode safety decision:
   * `production` | `staging` | `development` | `preview` | … . A `vite build`
   * always reports `PROD=true`, so a staging build must declare `staging` here.
   */
  readonly VITE_DEPLOY_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
