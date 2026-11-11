import { Button } from "@velnox/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@velnox/shared/components/ui/card";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Separator } from "@velnox/shared/components/ui/separator";

import { Logo } from "@velnox/shared/components/Logo";
import { SITE_URLS, apiBaseUrl, apiUrl } from "@velnox/shared/lib/sites";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  GOOGLE_AUTH_START_KEY,
  classifyGoogleError,
  recentGoogleAuthStart,
  type GoogleAuthErrorKind,
} from "@velnox/shared/lib/auth-flow";
import { ArrowLeft, Loader2, Mail, Lock, Eye, EyeOff, User, AlertCircle } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTurnstile } from "@velnox/shared/hooks/use-turnstile";

/** Which of the 3 SEPARATE apps this auth page is running inside. */
function currentSite(): "velshop" | "velseller" | "velcenter" {
  const host = window.location.hostname;
  // Production domains (Vercel preview + custom domains)
  if (/seller/i.test(host)) return "velseller";
  if (/center/i.test(host)) return "velcenter";
  // Path-based detection (legacy portal and local dev with basenames)
  const path = window.location.pathname;
  if (path.startsWith("/velseller") || path.startsWith("/seller")) return "velseller";
  if (path.startsWith("/velcenter") || path.startsWith("/center")) return "velcenter";
  return "velshop";
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

  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false); // Google flow in progress
  const signingInRef = useRef(false); // double-click / double-start guard
  // Member login (VelCenter only)
  const [memberMode, setMemberMode] = useState(false);
  const [memberIdentifier, setMemberIdentifier] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Turnstile
  const { token: turnstileToken, containerRef: turnstileRef, reset: resetTurnstile } = useTurnstile();

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

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !turnstileToken) {
      if (!turnstileToken) setError(t("auth.turnstile.error"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = { email: email.trim().toLowerCase(), password };
      if (turnstileToken !== "bypass") {
        body.turnstileToken = turnstileToken;
      }
      const res = await fetch(`${apiBaseUrl}/auth/password-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || t("auth.invalidCredentials"));
      }
      // Session cookie is set — reload to pick up auth state
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.loginError"));
      resetTurnstile();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailPasswordRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !turnstileToken) {
      if (!turnstileToken) setError(t("auth.turnstile.error"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = { name: name.trim(), email: email.trim().toLowerCase(), password };
      if (turnstileToken !== "bypass") {
        body.turnstileToken = turnstileToken;
      }
      const res = await fetch(`${apiBaseUrl}/auth/password-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || t("auth.registerError"));
      }
      // Session cookie is set — reload to pick up auth state
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.registerError"));
      resetTurnstile();
    } finally {
      setSubmitting(false);
    }
  };

  const handleMemberLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (memberLoading) return;
    setMemberLoading(true);
    setMemberError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/auth/member-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier: memberIdentifier.trim(), password: memberPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || t("auth.memberLoginError"));
      }
      // Session cookie is set — reload to pick up auth state
      window.location.reload();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : t("auth.memberLoginError"));
    } finally {
      setMemberLoading(false);
    }
  };

  const busy = signingIn || memberLoading || submitting;

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
        <Card className="relative w-full max-w-[400px] border shadow-md">
          <CardHeader className="text-center pb-2">
            <button
              type="button"
              onClick={handleBack}
              className="absolute left-4 top-4 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label={t("auth.backAria")}
            >
              <ArrowLeft className="size-4" />
              {t("auth.back")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mx-auto mb-5 cursor-pointer rounded-xl transition-opacity hover:opacity-80"
              aria-label={t("auth.backHomeAria")}
            >
              <Logo />
            </button>
            <CardTitle className="text-xl font-bold">{t(`auth.${mode}.title`)}</CardTitle>
            <CardDescription className="text-slate-500">{t(`auth.${mode}.desc`)}</CardDescription>
          </CardHeader>

          <CardContent className="grid gap-4">
            {/* Mode Switcher — Login / Register */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1" role="tablist" aria-label={t("auth.modeSwitcherLabel")}>
              <button
                role="tab"
                aria-selected={mode === "login"}
                onClick={() => { setMode("login"); setError(null); }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
                  mode === "login"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t("auth.login.title")}
              </button>
              <button
                role="tab"
                aria-selected={mode === "register"}
                onClick={() => { setMode("register"); setError(null); }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
                  mode === "register"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t("auth.register.title")}
              </button>
            </div>

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

            {/* Divider */}
            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide text-slate-400">
                <span className="bg-white px-2">{t("auth.or")}</span>
              </div>
            </div>

            {/* Email + Password Form */}
            <form onSubmit={mode === "login" ? handleEmailPasswordLogin : handleEmailPasswordRegister} className="grid gap-4">
              {mode === "register" && (
                <div className="grid gap-2">
                  <Label htmlFor="name" className="text-sm font-medium text-slate-700">
                    {t("auth.register.name")}
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("auth.register.name")}
                      className="h-12 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                      autoComplete="name"
                      required
                      disabled={busy}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                  {t(`auth.${mode}.email`)}
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t(`auth.${mode}.email`)}
                    className="h-12 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                    autoComplete="email"
                    required
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                    {t(`auth.${mode}.password`)}
                  </Label>
                  {mode === "login" && (
                    <a
                      href="/forgot-password"
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      {t("auth.login.forgotPassword")}
                    </a>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t(`auth.${mode}.password`)}
                    className="h-12 w-full rounded-md border border-slate-200 bg-white pl-10 pr-12 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </div>

              {/* Turnstile Widget */}
              <div
                ref={turnstileRef}
                className="w-full"
                data-testid="turnstile-widget"
              />

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-600 text-sm" role="alert">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="h-12 w-full rounded-md bg-brand text-white text-[15px] font-medium hover:bg-brand-strong disabled:opacity-50"
                disabled={busy || !turnstileToken}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {mode === "login" ? t("auth.login.signingIn") : t("auth.register.signingUp")}
                  </>
                ) : (
                  t(`auth.${mode}.submit`)
                )}
              </Button>
            </form>

            {/* Member login — VelCenter staff only */}
            {currentSite() === "velcenter" && mode === "login" && (
              <div className="mt-2 border-t border-slate-100 pt-4">
                {!memberMode ? (
                  <button
                    type="button"
                    onClick={() => setMemberMode(true)}
                    className="w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700"
                  >
                    {t("auth.memberLoginLabel")}
                  </button>
                ) : (
                  <form onSubmit={handleMemberLogin} className="grid gap-2.5">
                    <Input
                      type="text"
                      value={memberIdentifier}
                      onChange={(e) => setMemberIdentifier(e.target.value)}
                      placeholder={t("auth.memberIdentifierPlaceholder")}
                      className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                      autoComplete="username"
                      required
                    />
                    <Input
                      type="password"
                      value={memberPassword}
                      onChange={(e) => setMemberPassword(e.target.value)}
                      placeholder={t("auth.memberPasswordPlaceholder")}
                      className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                      autoComplete="current-password"
                      required
                    />
                    <Button
                      type="submit"
                      className="h-10 w-full rounded-md bg-brand text-white hover:bg-brand-strong"
                      disabled={memberLoading || !memberIdentifier.trim() || !memberPassword}
                    >
                      {memberLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      {t("auth.memberSubmit")}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setMemberMode(false); setMemberError(null); }}
                      className="text-center text-xs text-slate-400 hover:text-slate-600"
                    >
                      {t("auth.cancel")}
                    </button>
                  </form>
                )}
                {memberError && (
                  <p role="alert" className="mt-2 text-center text-sm text-red-500">{memberError}</p>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-600 text-sm" role="alert">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Terms & Privacy */}
            <p className="text-center text-xs leading-5 text-slate-400">
              {t("auth.terms")}{" "}
              <a href={`${SITE_URLS.corporate}/terms`} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">
                {t("auth.termsLink")}
              </a>
              {" · "}
              <a href={`${SITE_URLS.corporate}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">
                {t("auth.privacyLink")}
              </a>
            </p>

            {/* Guest / Later button */}
            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700 mt-2"
            >
              {mode === "login" ? t("auth.login.continueAsGuest") : t("auth.register.later")}
            </button>

            {/* Switch mode link */}
            <p className="text-center text-sm text-slate-500">
              {mode === "login" ? t("auth.login.noAccount") : t("auth.register.already")}
              <button
                type="button"
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
                className="ml-1 font-medium text-brand hover:underline"
              >
                {mode === "login" ? t("auth.register.title") : t("auth.login.title")}
              </button>
            </p>
          </CardContent>

          <div className="rounded-b-lg border-t bg-muted px-6 py-3 text-center text-xs text-slate-400">
            <p className="flex items-center justify-center gap-1">
              {t("auth.securedBy")}{" "}
              <a href="https://freebuff.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">
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
