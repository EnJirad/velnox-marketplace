/**
 * VelShop's MVP session accessor.
 *
 * The provider and the route guard live in `@velnox/shared/mvp/ui` because all
 * three MVP apps need exactly the same behaviour (one `/auth/me` read per mount,
 * loading → `/auth?returnTo=…`, and a retry instead of a false "signed out" when
 * the API is down). This module only gives the pages a local import path.
 */
export {
  MvpSessionProvider as SessionProvider,
  MvpRequireSession as RequireSession,
  useMvpSessionContext as useSession,
  type MvpSessionSeller,
} from "@velnox/shared/mvp/ui";
