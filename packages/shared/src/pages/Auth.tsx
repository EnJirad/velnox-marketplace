import { Button } from "@velnox/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@velnox/shared/components/ui/card";

import { Logo } from "@velnox/shared/components/Logo";
import { SITE_URLS, apiUrl } from "@velnox/shared/lib/sites";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  GOOGLE_AUTH_START_KEY,
  classifyGoogleError,
  recentGoogleAuthStart,
  type GoogleAuthErrorKind,
} from "@velnox/shared/lib/auth-flow";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

/** Which of the 3 SEPARATE apps this auth page is running inside. */
function currentSite(): "velshop" | "velseller" | "velcenter" {
  const path = window.location.pathname;
  if (path.startsWith("/velseller") || path.startsWith("/seller")) return "velseller";
  if (path.startsWith("/velcenter") || path.startsWith("/center")) return "velcenter";
  return "velshop"; // standalone shop domain (and the legacy portal) live under "/" paths
}

/**
 * Where to land after sign-in when no explicit returnTo was requested.
 * The 3 sites are separate apps, so cross-site homes are real entry URLs
 * (full page load) while in-app homes stay client-side routes.
 */
function roleHome(role: string | undefined): string {
  const isCenterRole = role === "owner" || role === "admin" || role === "staff";
  const site = currentSite();

  // velcenter: the company dashboard lives at the site root.
  if (site === "velcenter") return "/";
  // velseller: merchants land on their goals dashboard; company staff go to velcenter.
  if (site === "velseller") return isCenterRole ? SITE_URLS.velcenter : "/seller/goals";
  // velshop (and the portal): customers stay in the shop; send merchants and
  // company staff to the site that matches their role. The shop's own routes
  // live at the domain root (standalone deploy), so the home is "/".
  if (isCenterRole) return SITE_URLS.velcenter;
  if (role === "seller") return SITE_URLS.velseller;
  return "/";
}

/**
 * Official Google "G" logo (brand colors) — the sign-in button must carry
 * Google's own branding per Google's brand guidelines.
 */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18a11 11 0 0 0 0 9.87l3.66-2.85Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
      />
    </svg>
  );
}

/**
 * User-facing copy for every Google sign-in error kind. Only safe, friendly
 * messages — never request ids, env-var names, OAuth secrets, provider
 * responses or stack traces.
 */
const ERROR_MESSAGE_KEYS: Record<GoogleAuthErrorKind, string> = {
  cancelled: "auth.googleCancelled",
  network: "auth.networkError",
  generic: "auth.googleError",
};

function Auth() {
  const { t } = useLanguage();
  const { isLoading: authLoading, isAuthenticated, user, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const [signingIn, setSigningIn] = useState(false); // Google flow in progress
  const [error, setError] = useState<string | null>(null);
  const signingInRef = useRef(false); // double-click / double-start guard

  // ---- Redirect after auth session is created -------------
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    const target =
      returnTo?.startsWith("/") && !returnTo.startsWith("//")
        ? returnTo
        : roleHome(user?.role);
    // Cross-app entry URLs (e.g. a legacy /velseller/... path or another
    // app's route) belong to a different app — a client-side navigate would
    // render 404 inside this router instead.
    if (target.startsWith("/vel") || !target.startsWith("/")) {
      window.location.assign(target);
    } else {
      navigate(target);
    }
  }, [authLoading, isAuthenticated, navigate, returnTo, user?.role]);

  // ---- Cancellation detection -------------------------------------------
  // A Google flow started from this tab navigates AWAY to accounts.google.com
  // and comes back through the OAuth callback. If we return to /auth
  // without a session and without an in-flight `code`, the user cancelled at
  // Google's Account Chooser. The marker survives the navigation
  // (sessionStorage) and is removed once the state settles.
  useEffect(() => {
    if (authLoading) return;
    const raw = sessionStorage.getItem(GOOGLE_AUTH_START_KEY);
    if (raw === null) return;
    if (isAuthenticated) {
      sessionStorage.removeItem(GOOGLE_AUTH_START_KEY);
      return;
    }
    if (recentGoogleAuthStart(raw, Date.now()) === null) {
      // Stale marker (tab was closed mid-flow, then reopened) — ignore it.
      sessionStorage.removeItem(GOOGLE_AUTH_START_KEY);
      return;
    }
    // Give the backend redirect a moment before concluding the user
    // cancelled at Google's Account Chooser.
    const timer = window.setTimeout(() => {
      if (sessionStorage.getItem(GOOGLE_AUTH_START_KEY) === null) return; // completed meanwhile
      sessionStorage.removeItem(GOOGLE_AUTH_START_KEY);
      setError(t("auth.googleCancelled"));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [authLoading, isAuthenticated, t]);

  /**
   * Start the Google OAuth flow.
   * Redirects the browser to the backend /auth/google endpoint which
   * constructs the Google OAuth URL server-side (where GOOGLE_CLIENT_ID
   * is securely stored), handles the callback, creates a session cookie,
   * and redirects back to the frontend.
   */
  const handleGoogleSignIn = async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setSigningIn(true);
    setError(null);
    try {
      sessionStorage.setItem(GOOGLE_AUTH_START_KEY, String(Date.now()));
      const apiBase = apiUrl;
      const backendReturnTo = returnTo || "/";
      window.location.href = `${apiBase}/auth/google?returnTo=${encodeURIComponent(backendReturnTo)}`;
    } catch (error) {
      const kind = classifyGoogleError(error);
      console.error(`[auth] Google sign-in failed (${kind})`);
      sessionStorage.removeItem(GOOGLE_AUTH_START_KEY);
      setError(t(ERROR_MESSAGE_KEYS[kind]));
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  };

  const busy = signingIn;

  // No login-form flash (spec §92–§97, §99–§100): while the session is still
  // loading — or right after authentication resolved but before the redirect
  // effect navigates — show a quiet loading state instead of the login form.
  // The auth state is the source of truth; the form only ever renders for a
  // confirmed UNAUTHENTICATED session.
  if (authLoading || isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <Logo />
        <Loader2 className="mt-8 size-6 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Auth Content — centered card on desktop, app-like on mobile */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 pb-[max(env(safe-area-inset-bottom),2rem)]">
        <Card className="relative w-full max-w-[400px] border shadow-md pb-0">
          <CardHeader className="text-center">
            <button
              type="button"
              onClick={handleBack}
              className="absolute left-4 top-4 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="ย้อนกลับ"
            >
              <ArrowLeft className="size-4" />
              ย้อนกลับ
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mx-auto mb-5 cursor-pointer rounded-xl transition-opacity hover:opacity-80"
              aria-label={t("auth.backHomeAria")}
            >
              <Logo />
            </button>
            <CardTitle className="text-xl">{t("auth.welcome")}</CardTitle>
            <CardDescription>{t("auth.googleDesc")}</CardDescription>
          </CardHeader>

          <CardContent className="grid gap-3">
            {/* Google Sign-In — official branding, real OAuth flow */}
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full gap-3 border-slate-300 bg-white text-[15px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              onClick={handleGoogleSignIn}
              disabled={busy}
            >
              {signingIn ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  {t("auth.signingInGoogle")}
                </>
              ) : (
                <>
                  <GoogleIcon className="h-5 w-5 shrink-0" />
                  {t("auth.googleContinue")}
                </>
              )}
            </Button>

            {error && (
              <p role="alert" className="text-center text-sm text-red-500">
                {error}
              </p>
            )}

            <p className="mt-1 text-center text-xs leading-5 text-muted-foreground">
              {t("auth.terms")}
            </p>
          </CardContent>

          <div className="rounded-b-lg border-t bg-muted px-6 py-4 text-center text-xs text-muted-foreground">
            <div className="mb-1.5 flex items-center justify-center gap-2">
              <a
                href={`${SITE_URLS.corporate}/terms`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-primary"
              >
                {t("auth.termsLink")}
              </a>
              <span aria-hidden="true">·</span>
              <a
                href={`${SITE_URLS.corporate}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-primary"
              >
                {t("auth.privacyLink")}
              </a>
            </div>
            <p>
              Secured by{" "}
              <a
                href="https://freebuff.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-primary"
              >
                freebuff.com
              </a>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <Auth />
    </Suspense>
  );
}
