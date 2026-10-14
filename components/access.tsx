"use client";
import { useEffect, useRef, useState } from "react";
import {
  Layers3,
  LockKeyhole,
  Radio,
  ShieldCheck,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/client";
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}
export function Captcha({
  siteKey,
  action,
  onToken,
  reset,
}: {
  siteKey: string;
  action: "login" | "register" | "recover";
  onToken: (s: string) => void;
  reset: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let id: string | undefined;
    let stopped = false;
    const render = () => {
      if (!stopped && box.current && window.turnstile)
        id = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          callback: (t: string) => callback.current(t),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
    };
    if (window.turnstile) render();
    else {
      let script =
        document.querySelector<HTMLScriptElement>("#turnstile-script");
      if (!script) {
        script = document.createElement("script");
        script.id = "turnstile-script";
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      stopped = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, action, reset]);
  return <div ref={box} className="captcha" />;
}
export function Access({
  status,
  onLogin,
  onPreview,
}: {
  status: { configured: boolean; site_key?: string; preview_enabled?: boolean };
  onLogin: () => void;
  onPreview: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "recover">("login"),
    [token, setToken] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [reset, setReset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    for (const key of ["invite", "recover"])
      if (params.has(key)) {
        setToken(params.get(key)!);
        setMode(key === "invite" ? "register" : "recover");
        history.replaceState(null, "", location.pathname);
      }
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(mode, {
        username: data.get("username"),
        password: data.get("password"),
        captcha,
        token,
        ...(mode === "register" ? { whatsapp_opt_in: whatsappOptIn } : {}),
      });
      if (mode === "login") onLogin();
      else {
        setNotice(
          mode === "register"
            ? "Account created. Sign in with your new username and password." +
              (whatsappOptIn ? " Open WhatsApp alerts in your settings to join the group." : "")
            : "Password updated. You can sign in now.",
        );
        setMode("login");
        setToken("");
        setWhatsappOptIn(false);
        e.currentTarget?.reset();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setCaptcha("");
      setReset((x) => x + 1);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">
          <Layers3 /> StackSignal
        </div>
        <div>
          <span className="eyebrow">
            <Radio size={14} /> ENGINEERING INTELLIGENCE
          </span>
          <h1>
            The whole stack.
            <br />
            <em>A clearer signal.</em>
          </h1>
          <p>
            Keep pace with the infrastructure, research and open source that
            moves your team forward.
          </p>
          <div className="stack-lines">
            <span>01 — SILICON & FABRIC</span>
            <span>02 — PLATFORM & RUNTIME</span>
            <span>03 — MODELS & INFERENCE</span>
          </div>
        </div>
        <small>From silicon to tokens.</small>
      </section>
      <section className="login-form">
        <div className="login-card">
          <div className="lock-badge">
            <LockKeyhole size={24} />
          </div>
          <h2>
            {mode === "login"
              ? "Welcome back."
              : mode === "register"
                ? "Join your team."
                : "Reset your password."}
          </h2>
          <p>
            {mode === "login"
              ? "Your team's knowledge, in one place."
              : "Choose a strong passphrase of at least 16 characters."}
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <form onSubmit={submit}>
            <label>
              Username
              <input
                name="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z][a-zA-Z0-9_-]{2,31}"
                autoComplete="username"
                placeholder="Your username"
              />
            </label>
            <label>
              {mode === "login" ? "Password" : "New password"}
              <input
                name="password"
                type="password"
                required
                minLength={mode === "login" ? 1 : 16}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "login"
                    ? "Your password"
                    : "A long, unique passphrase"
                }
              />
            </label>
            {mode === "register" && <>
              <label className="whatsapp-opt-in">
                <input type="checkbox" checked={whatsappOptIn} onChange={e => setWhatsappOptIn(e.target.checked)} />
                <span>Notify me about top-tier drops via WhatsApp.</span>
              </label>
              {whatsappOptIn && <p className="whatsapp-signup-help">After signing in, open WhatsApp alerts to join the private group. Members may see your name and phone number. Leave the group to stop its messages.</p>}
            </>}
            {status.configured && status.site_key && (
              <Captcha
                siteKey={status.site_key}
                action={mode}
                onToken={setCaptcha}
                reset={reset}
              />
            )}
            <button
              className="primary"
              disabled={!status.configured || busy || !captcha}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : mode === "login" ? (
                "Sign in"
              ) : mode === "register" ? (
                "Create account"
              ) : (
                "Reset password"
              )}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="muted">
            <ShieldCheck size={14} /> Invitation-only workspace
          </p>
          {!status.configured && (
            <>
              <div className="setup-hint">
                Account service setup is pending.
              </div>
              {status.preview_enabled && (
                <button className="text-button" onClick={onPreview}>
                  Explore your library <ArrowRight size={14} />
                </button>
              )}
            </>
          )}
          {mode === "login" && status.configured && (
            <p className="setup-hint">
              Need access or a password reset?
              <br />
              Contact your workspace administrator.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
export function SecurityGate({
  session,
  onRefresh,
  onLogout,
  onSessionEnded,
}: {
  session: any;
  onRefresh: () => void;
  onLogout: () => void;
  onSessionEnded: () => void;
}) {
  const [factor, setFactor] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const existing = session.factors?.find((x: any) => x.status === "verified");
  async function run(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="security-gate">
      <div className="login-card">
        <div className="brand">
          <Layers3 /> StackSignal
        </div>
        <h2>
          {session.must_change_password
            ? "Make this account yours."
            : "Secure your workspace."}
        </h2>
        <p>
          {session.must_change_password
            ? "Replace your temporary administrator password."
            : "An authenticator is required for administrators and maintainers."}
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {session.must_change_password ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(async () => {
                await api("change-password", {
                  current_password: d.get("current"),
                  password: d.get("password"),
                });
                onSessionEnded();
              });
            }}
          >
            <label>
              Temporary password
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              New passphrase
              <input
                name="password"
                type="password"
                minLength={16}
                autoComplete="new-password"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              Update password & sign in again
            </button>
          </form>
        ) : (
          <>
            {!existing && !factor && (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => setFactor(await api("mfa/enroll", {})))
                }
              >
                Set up authenticator
              </button>
            )}
            {factor && (
              <div className="mfa-secret">
                <p className="subtle">
                  Add this setup key to your authenticator app (TOTP). Keep it
                  private.
                </p>
                <code>{factor.totp.secret}</code>
              </div>
            )}
            {(existing || factor) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void run(async () => {
                    await api("mfa/verify", {
                      factor_id: existing?.id || factor.id,
                      code: d.get("code"),
                    });
                    onRefresh();
                  });
                }}
              >
                <label>
                  Six-digit code
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Verify & continue
                </button>
              </form>
            )}
          </>
        )}
        <button className="text-button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
