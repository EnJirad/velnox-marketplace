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
import {
  SUPPORTED_LANGUAGES,
  languageLabel,
  useLanguage,
  type Language,
} from "@velnox/shared/lib/i18n";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  GOOGLE_AUTH_START_KEY,
  classifyGoogleError,
  recentGoogleAuthStart,
  type GoogleAuthErrorKind,
} from "@velnox/shared/lib/auth-flow";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  Mail,
} from "lucide-react";
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
  const { t, lang, setLang } = useLanguage();
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
  // Sign-up asks for the password twice and never for a display name: the
  // name can be set later from the profile, and a typo in an unverified
  // password locks the customer out of the account they just created.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false); // Google flow in progress
  const signingInRef = useRef(false); // double-click / double-start guard
  // Member login (VelCenter only). The form is always visible there — there is
  // no toggle any more, because VelCenter has no other way in.
  const [memberIdentifier, setMemberIdentifier] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  /**
   * Cloudflare Turnstile — the bot gate in front of every credential submit.
   *
   * One widget serves every form on this page, with the single action name
   * `auth`. Cloudflare echoes it back and the backend verifies it, so a token
   * minted anywhere else is rejected. Cross-form reuse is already impossible
   * because the backend treats each token as single-use.
   *
   * `turnstile.ready` is the ONLY thing that may enable a submit button.
   * There is no bypass value: when the site key is missing the state is
   * `unavailable` and every button stays genuinely disabled.
   */
  const turnstile = useTurnstile({ action: "auth" });
  const turnstileRef = turnstile.containerRef;
  const turnstileReady = turnstile.ready;
  const [langOpen, setLangOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);

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

  // A blocked Google start comes back as `?error=preauth_required` — the
  // challenge was not solved (or the proof expired), so say so plainly instead
  // of leaving the customer on a silent page.
  useEffect(() => {
    if (searchParams.get("error") === "preauth_required") {
      setError(t("auth.turnstile.required"));
    }
  }, [searchParams, t]);

  // Close the language menu on an outside click or Escape.
  useEffect(() => {
    if (!langOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!langMenuRef.current?.contains(event.target as Node)) setLangOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLangOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [langOpen]);

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
    if (!turnstileReady || !turnstile.token) {
      setError(t("auth.turnstile.required"));
      return;
    }
    signingInRef.current = true;
    setSigningIn(true);
    setError(null);
    try {
      // ── PRE-AUTH PROOF ────────────────────────────────────────────────
      // GET /auth/google is a full-page navigation and cannot carry a body,
      // so the challenge is exchanged for a short-lived one-time proof cookie
      // first. The backend refuses to start OAuth without it, which is what
      // stops anyone from driving the redirect directly.
      const proofRes = await fetch(`${apiBaseUrl}/auth/preauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ turnstileToken: turnstile.token }),
      });
      if (!proofRes.ok) {
        const payload = await proofRes.json().catch(() => null);
        const code = payload?.error?.code as string | undefined;
        turnstile.consume();
        throw new Error(
          code === "TURNSTILE_UNAVAILABLE" || code === "TURNSTILE_TIMEOUT"
            ? t("auth.turnstile.networkError")
            : t("auth.turnstile.required"),
        );
      }

      sessionStorage.setItem(GOOGLE_AUTH_START_KEY, String(Date.now()));
      const apiBase = apiUrl;
      const backendReturnTo = returnTo || "/";
      window.location.href = `${apiBase}/auth/google?returnTo=${encodeURIComponent(backendReturnTo)}`;
    } catch (error) {
      const kind = classifyGoogleError(error);
      console.error(`[auth] Google sign-in failed (${kind})`);
      sessionStorage.removeItem(GOOGLE_AUTH_START_KEY);
      // A custom message (turnstile failure) is more useful than the generic
      // Google copy, so prefer it when present.
      setError(
        error instanceof Error && error.message && !/^Network|Failed to fetch/i.test(error.message)
          ? error.message
          : t(ERROR_MESSAGE_KEYS[kind]),
      );
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  };

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    // Double-submit guard (a second Enter press while in flight).
    if (submitting || signingIn || memberLoading) return;
    // Real gate: no token, no request. There is no placeholder token any more.
    if (!turnstileReady || !turnstile.token) {
      setError(t("auth.turnstile.required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        email: email.trim().toLowerCase(),
        password,
        turnstileToken: turnstile.token,
      };
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
      // The token is single-use and already spent — a fresh challenge must be
      // solved before the next attempt.
      turnstile.consume();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailPasswordRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || signingIn || memberLoading) return;
    if (!turnstileReady || !turnstile.token) {
      setError(t("auth.turnstile.required"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    // Never create an account whose password the customer cannot reproduce.
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        email: email.trim().toLowerCase(),
        password,
        turnstileToken: turnstile.token,
      };
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
      turnstile.consume();
    } finally {
      setSubmitting(false);
    }
  };

  const handleMemberLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (memberLoading || submitting || signingIn) return;
    // Staff sign-in had NO bot gate at all before this change.
    if (!turnstileReady || !turnstile.token) {
      setMemberError(t("auth.turnstile.required"));
      return;
    }
    setMemberLoading(true);
    setMemberError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/auth/member-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          identifier: memberIdentifier.trim(),
          password: memberPassword,
          turnstileToken: turnstile.token,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || t("auth.memberLoginError"));
      }
      // Session cookie is set — reload to pick up auth state
      window.location.reload();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : t("auth.memberLoginError"));
      turnstile.consume();
    } finally {
      setMemberLoading(false);
    }
  };

  const busy = signingIn || memberLoading || submitting;
  /** VelCenter is staff-only: no Google, no self-registration. */
  const isCenter = currentSite() === "velcenter";
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const registerMismatch = mode === "register" && !passwordsMatch;
  const submitDisabled = busy || !turnstileReady || registerMismatch;

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

  /**
   * The Cloudflare widget, once.
   *
   * The instructions line and the "waiting for verification" status are gone:
   * the widget already says what it is doing, and the status text was a second
   * line that only pushed the form down. What remains is the widget itself and
   * — because they are actionable — the three failure states. Everything else
   * (loading / verifying / verified) is visible on the widget.
   */
  const turnstileBlock = (
    <div className="w-full">
      <div
        ref={turnstileRef}
        className="flex min-h-[65px] w-full items-center justify-center"
        data-testid="turnstile-widget"
        data-state={turnstile.state}
      />
      {(turnstile.state === "expired" ||
        turnstile.state === "error" ||
        turnstile.state === "unavailable") && (
        <div
          className="mt-0.5 flex items-center justify-center gap-1.5 text-2xs"
          role="status"
          aria-live="polite"
        >
          {turnstile.state === "expired" ? (
            <>
              <AlertCircle className="size-3.5 shrink-0 text-amber-500" aria-hidden />
              <span className="font-medium text-amber-600">{t("auth.turnstile.expired")}</span>
            </>
          ) : turnstile.state === "error" ? (
            <>
              <AlertCircle className="size-3.5 shrink-0 text-red-500" aria-hidden />
              <span className="font-medium text-red-600">{t("auth.turnstile.error")}</span>
            </>
          ) : (
            <>
              <AlertTriangle className="size-3.5 shrink-0 text-red-500" aria-hidden />
              <span className="font-medium text-red-600">{t("auth.turnstile.unavailable")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );

  const errorBox = (message: string) => (
    <div className="flex items-center gap-2 rounded-squircle-sm bg-red-50 px-3 py-2 text-red-600 text-xs" role="alert">
      <AlertCircle className="size-3.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </div>
  );

  const passwordToggle = (shown: boolean, onToggle: () => void, label: string) => (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-squircle-sm p-1.5 text-slate-400 transition-colors hover:text-slate-600"
      aria-label={label}
    >
      {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* One compact card that fits a phone without scrolling. Removed on
          purpose: the logo block, the mode description, the Turnstile
          instructions, the verification status text and the Cloudflare footer.
          Every remaining line either takes input or is actionable. */}
      <div className="flex min-h-[100dvh] items-center justify-center px-3 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <Card className="relative w-full max-w-[380px] gap-0 border py-0 shadow-sm">
          <CardHeader className="relative px-4 pb-0.5 pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleBack}
                className="-ml-1.5 flex items-center gap-1 rounded-squircle-sm px-1.5 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={t("auth.backAria")}
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                {t("auth.back")}
              </button>

              {/* Language selector — instant switch, persisted by the shared
                  i18n provider; never reloads, never resets the form, never
                  touches the URL or returnTo. */}
              <div ref={langMenuRef}>
                <button
                  type="button"
                  onClick={() => setLangOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={langOpen}
                  aria-label={t("auth.languageSelector")}
                  className="flex items-center gap-1 rounded-squircle-sm border border-slate-200 bg-white px-2 py-1 text-2xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <Globe className="size-3" aria-hidden />
                  <span>{languageLabel(lang)}</span>
                </button>
                {langOpen && (
                  <ul
                    role="listbox"
                    aria-label={t("auth.languageSelector")}
                    className="absolute right-3 z-20 mt-1 w-40 overflow-hidden rounded-squircle border border-slate-200 bg-white py-1 shadow-float"
                  >
                    {SUPPORTED_LANGUAGES.map((option) => {
                      const selected = option.code === lang;
                      return (
                        <li key={option.code}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setLang(option.code as Language);
                              setLangOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                              selected
                                ? "bg-brand/10 font-semibold text-brand-strong"
                                : "text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            <span>{option.label}</span>
                            {selected && <Check className="size-3 shrink-0" aria-hidden />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <CardTitle className="text-center text-lg font-bold tracking-tight">
              {/* VelCenter is staff-only, so its title is the staff form's. */}
              {isCenter ? t("auth.memberLoginLabel") : t(`auth.${mode}.title`)}
            </CardTitle>
          </CardHeader>

          <CardContent className="grid gap-2.5 px-4 pb-3 pt-2.5">
            {!isCenter && (
              <div
                className="flex gap-1 rounded-squircle bg-slate-100 p-1"
                role="tablist"
                aria-label={t("auth.modeSwitcherLabel")}
              >
                <button
                  role="tab"
                  aria-selected={mode === "login"}
                  onClick={() => { setMode("login"); setError(null); }}
                  className={`flex-1 rounded-squircle-sm py-1.5 text-xs font-medium transition-colors ${
                    mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t("auth.login.title")}
                </button>
                <button
                  role="tab"
                  aria-selected={mode === "register"}
                  onClick={() => { setMode("register"); setError(null); }}
                  className={`flex-1 rounded-squircle-sm py-1.5 text-xs font-medium transition-colors ${
                    mode === "register" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t("auth.register.title")}
                </button>
              </div>
            )}

            {!isCenter && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full gap-2.5 rounded-squircle border-slate-300 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                onClick={handleGoogleSignIn}
                disabled={busy || !turnstileReady}
              >
                {signingIn ? (
                  <>
                    <Loader2 className="size-4 animate-spin text-slate-400" />
                    {t("auth.signingInGoogle")}
                  </>
                ) : (
                  <>
                    <GoogleIcon className="size-4 shrink-0" />
                    {t("auth.googleContinue")}
                  </>
                )}
              </Button>
            )}

            {!isCenter && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-2xs uppercase tracking-wide text-slate-400">
                  <span className="bg-card px-2">{t("auth.or")}</span>
                </div>
              </div>
            )}

            {isCenter ? (
              /* ── VelCenter: staff credentials only ──────────────────────
                 No Google sign-in and no self-registration: a staff session
                 can only come from a member ID / email plus a password that
                 VelCenter issued. */
              <form onSubmit={handleMemberLogin} className="grid gap-2.5">
                <Input
                  type="text"
                  value={memberIdentifier}
                  onChange={(e) => setMemberIdentifier(e.target.value)}
                  placeholder={t("auth.memberIdentifierPlaceholder")}
                  aria-label={t("auth.memberIdentifierPlaceholder")}
                  className="h-11 rounded-squircle border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                  autoComplete="username"
                  required
                  disabled={memberLoading}
                />
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={memberPassword}
                    onChange={(e) => setMemberPassword(e.target.value)}
                    placeholder={t("auth.memberPasswordPlaceholder")}
                    aria-label={t("auth.memberPasswordPlaceholder")}
                    className="h-11 rounded-squircle border-slate-200 bg-white pl-3 pr-10 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                    autoComplete="current-password"
                    required
                    disabled={memberLoading}
                  />
                  {passwordToggle(showPassword, () => setShowPassword(!showPassword), showPassword ? t("auth.hidePassword") : t("auth.showPassword"))}
                </div>

                {turnstileBlock}

                {memberError && errorBox(memberError)}

                <Button
                  type="submit"
                  className="h-11 w-full rounded-squircle bg-brand text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50"
                  disabled={memberLoading || !memberIdentifier.trim() || !memberPassword || !turnstileReady}
                >
                  {memberLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t("auth.memberSubmit")}
                    </>
                  ) : (
                    t("auth.memberSubmit")
                  )}
                </Button>
              </form>
            ) : (
              <form
                onSubmit={mode === "login" ? handleEmailPasswordLogin : handleEmailPasswordRegister}
                className="grid gap-2.5"
              >
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t(`auth.${mode}.email`)}
                  aria-label={t(`auth.${mode}.email`)}
                  className="h-11 w-full rounded-squircle border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                  autoComplete="email"
                  required
                  disabled={busy}
                />

                <div className="grid gap-1">
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t(`auth.${mode}.password`)}
                      aria-label={t(`auth.${mode}.password`)}
                      className="h-11 w-full rounded-squircle border border-slate-200 bg-white pl-3 pr-10 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      required
                      disabled={busy}
                    />
                    {passwordToggle(showPassword, () => setShowPassword(!showPassword), showPassword ? t("auth.hidePassword") : t("auth.showPassword"))}
                  </div>
                  {mode === "login" && (
                    <a
                      href="/forgot-password"
                      className="justify-self-end text-2xs font-medium text-brand hover:underline"
                    >
                      {t("auth.login.forgotPassword")}
                    </a>
                  )}
                </div>

                {mode === "register" && (
                  <div className="grid gap-1">
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t("auth.register.confirmPassword")}
                        aria-label={t("auth.register.confirmPassword")}
                        className="h-11 w-full rounded-squircle border border-slate-200 bg-white pl-3 pr-10 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                        autoComplete="new-password"
                        required
                        disabled={busy}
                        aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
                      />
                      {passwordToggle(showConfirmPassword, () => setShowConfirmPassword(!showConfirmPassword), showConfirmPassword ? t("auth.hidePassword") : t("auth.showPassword"))}
                    </div>
                    {confirmPassword.length > 0 && !passwordsMatch && (
                      <p className="text-2xs font-medium text-red-600" role="alert">
                        {t("auth.passwordMismatch")}
                      </p>
                    )}
                  </div>
                )}

                {turnstileBlock}

                {error && errorBox(error)}

                <Button
                  type="submit"
                  className="h-11 w-full rounded-squircle bg-brand text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-50"
                  disabled={submitDisabled}
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
            )}

            {!isCenter && (
              <>
                <p className="text-center text-2xs leading-4 text-slate-400">
                  <a href={`${SITE_URLS.corporate}/terms`} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">
                    {t("auth.termsLink")}
                  </a>
                  {" · "}
                  <a href={`${SITE_URLS.corporate}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">
                    {t("auth.privacyLink")}
                  </a>
                </p>

                <p className="text-center text-xs text-slate-500">
                  {mode === "login" ? t("auth.login.noAccount") : t("auth.register.already")}
                  <button
                    type="button"
                    onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
                    className="ml-1 font-medium text-brand hover:underline"
                  >
                    {mode === "login" ? t("auth.register.title") : t("auth.login.title")}
                  </button>
                </p>
              </>
            )}
          </CardContent>
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
