"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const GOOGLE_MSG: Record<string, string> = {
  off: "Google sign-in is set up but not switched on yet — use your email for now.",
  denied: "Please use your @goocampus.in Google account.",
  unknown: "That Google account isn't on the team roster yet.",
  failed: "Google sign-in didn't complete. Try again, or use your email.",
};

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 15.4 2 8 6.9 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 46c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.6C29.6 36.6 26.9 38 24 38c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C8.1 41.1 15.4 46 24 46z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.5l6.6 5.6C39.9 41 44 34.5 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

// Electric blue from the reference. Swap to the dashboard violet (#6D5CE7) if you
// prefer the login to match the app's accent instead of the reference exactly.
const ACCENT = "#2F39E8";
const TEAL = "#5FE9C4";

// Getting back in without a password. Removing the shared team password left no
// way back for anyone who forgot theirs — only Google (production only) or an
// admin at a terminal. Two steps, both on routes that already existed:
// forgot-password emails a code, accept-invite turns code + new password into a
// real password. On success we sign in with the password just set, so nobody has
// to type it twice.
function ForgotPanel({ accent, initialEmail, onBack, onSignedIn }: {
  accent: string; initialEmail: string; onBack: () => void; onSignedIn: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const field = "w-full px-4 py-3.5 rounded-xl border-2 text-[14px] placeholder:text-gray-300 focus:outline-none transition";
  const edge = { borderColor: "#E3E5EE" };
  const focus = (e: React.FocusEvent<HTMLInputElement>) => (e.currentTarget.style.borderColor = accent);
  const blur = (e: React.FocusEvent<HTMLInputElement>) => (e.currentTarget.style.borderColor = "#E3E5EE");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setNote("");
    try {
      const r = await fetch("/api/account/forgot-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't send the code."); return; }
      setNote(j.message || "Check your email."); setStep(2);
    } finally { setBusy(false); }
  }

  async function setPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setNote("");
    try {
      const r = await fetch("/api/account/accept-invite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't set the password."); return; }
      // Straight in with what they just chose.
      const li = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });
      if (li.ok) onSignedIn();
      else { setNote("Password updated — sign in with it now."); onBack(); }
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={step === 1 ? sendCode : setPassword} className="auth-form mt-8 space-y-4">
      <p className="text-[13px] text-gray-500 leading-relaxed">
        {step === 1
          ? "Enter the email you sign in with and we'll send a 6-digit code."
          : "Enter the code from your email and choose a new password."}
      </p>

      <div className="relative">
        <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium text-gray-400">E-mail</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@goocampus.in" autoComplete="username" disabled={step === 2}
          className={field + " disabled:bg-gray-50 disabled:text-gray-500"} style={edge} onFocus={focus} onBlur={blur} />
      </div>

      {step === 2 && (
        <>
          <div className="relative">
            <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium text-gray-400">6-digit code</label>
            <input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456" autoComplete="one-time-code"
              className={field + " tracking-[0.3em]"} style={edge} onFocus={focus} onBlur={blur} />
          </div>
          <div className="relative">
            <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium text-gray-400">New password</label>
            <input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="At least 8 characters" autoComplete="new-password"
              className={field} style={edge} onFocus={focus} onBlur={blur} />
          </div>
        </>
      )}

      {note && <p className="text-[12.5px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{note}</p>}
      {err && <p className="text-[13px] text-red-500">{err}</p>}

      <button disabled={busy}
        className="w-full py-3.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60 transition hover:brightness-95"
        style={{ background: accent }}>
        {busy ? "Working…" : step === 1 ? "Send code" : "Set password and sign in"}
      </button>

      <button type="button" onClick={onBack}
        className="w-full text-[13px] text-gray-500 hover:text-gray-700 transition">
        Back to sign in
      </button>
    </form>
  );
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [googleNote, setGoogleNote] = useState("");
  const [forgot, setForgot] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get("google");
    if (g && GOOGLE_MSG[g]) setGoogleNote(GOOGLE_MSG[g]);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, email }),
    });
    setLoading(false);
    if (res.ok) {
      // `startsWith("/")` alone is not enough: "//attacker.example" passes it
      // and is a protocol-relative URL, so the browser leaves the site. That
      // turns a real login on the real domain with a valid certificate into a
      // bounce to an attacker's clone the instant someone signs in
      // successfully — the most credible phishing there is, and it costs
      // nothing but a link. "/\" is the same trick in some browsers.
      // app/api/notifications already guards this exact pattern.
      const next = new URLSearchParams(window.location.search).get("next");
      // Resolved against this site: anything that lands on another origin (tabs,
      // backslashes, "//") is refused.
      let safe = false;
      try { safe = !!next && next.startsWith("/") && new URL(next, window.location.origin).origin === window.location.origin; } catch { safe = false; }
      router.push(safe ? next! : "/me");
      return;
    }
    type LoginErr = { error?: string };
    let body: LoginErr = {};
    try { body = await res.json(); } catch {}
    if (res.status === 429) setError(body.error || "Too many attempts. Try again in a few minutes.");
    else setError("Wrong email or password.");
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8" style={{ background: "#EDEFF5" }}>
      <div className="w-full max-w-[1040px] bg-white rounded-[28px] shadow-[0_20px_60px_-20px_rgba(20,21,60,0.25)] overflow-hidden grid grid-cols-1 lg:grid-cols-2">

        {/* LEFT — form */}
        <div className="px-8 sm:px-12 py-10 sm:py-14 flex flex-col">
          <div className="text-[13px] text-gray-400 mb-10">
            GooCampus <span className="font-medium" style={{ color: ACCENT }}>Marketing OS</span>
          </div>

          <div className="my-auto max-w-[360px] w-full mx-auto lg:mx-0">
            <h1 className="text-[34px] sm:text-[38px] font-bold tracking-tight text-gray-900 leading-none">Welcome back</h1>
            <p className="text-[13.5px] text-gray-400 mt-3 leading-relaxed">
              Sign in to your Marketing OS.<br />Internal team access only.
            </p>

            {forgot ? (
              <ForgotPanel
                accent={ACCENT}
                initialEmail={email}
                onBack={() => setForgot(false)}
                onSignedIn={() => router.replace("/dashboard/preview")}
              />
            ) : (
            <form onSubmit={submit} className="auth-form mt-8 space-y-4">
              {/* Email */}
              <div className="relative">
                <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium" style={{ color: ACCENT }}>E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@goocampus.in"
                  autoComplete="username"
                  className="w-full px-4 py-3.5 rounded-xl border-2 text-[14px] placeholder:text-gray-300 focus:outline-none transition"
                  style={{ borderColor: "#E3E5EE" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#E3E5EE")}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 text-[15px]">@</span>
              </div>

              {/* Password */}
              <div className="relative">
                <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium text-gray-400">Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="w-full px-4 py-3.5 pr-11 rounded-xl border-2 text-[14px] placeholder:text-gray-300 focus:outline-none transition"
                  style={{ borderColor: "#E3E5EE" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#E3E5EE")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>

              <button type="button" onClick={() => setForgot(true)}
                className="-mt-1 self-end text-[12.5px] text-gray-400 hover:text-gray-600 transition">
                Forgot password?
              </button>

              {error && <p className="text-[13px] text-red-500">{error}</p>}
              {googleNote && <p className="text-[12.5px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{googleNote}</p>}

              <button
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60 transition hover:brightness-95"
                style={{ background: ACCENT }}
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[11px] text-gray-400">or</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              {/* Google — a full GET navigation to the OAuth flow (not a fetch) */}
              <a
                href="/api/auth/google/start"
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border-2 text-[13.5px] font-medium text-gray-700 hover:bg-gray-50 transition"
                style={{ borderColor: "#E3E5EE" }}
              >
                <GoogleIcon /> Sign in with Google
              </a>
            </form>
            )}
          </div>
        </div>

        {/* RIGHT — branded panel (content is a placeholder — swap for your options) */}
        <div className="hidden lg:flex relative m-3 rounded-[22px] overflow-hidden flex-col justify-center px-12" style={{ background: ACCENT }}>
          {/* faint concentric texture */}
          <div className="absolute inset-0 opacity-[0.13]" style={{ backgroundImage: "radial-gradient(circle at 70% 40%, transparent 0, transparent 38%, white 38.4%, transparent 39%), radial-gradient(circle at 70% 40%, transparent 0, transparent 50%, white 50.4%, transparent 51%), radial-gradient(circle at 70% 40%, transparent 0, transparent 62%, white 62.4%, transparent 63%)" }} />
          <div className="relative">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-7" style={{ background: TEAL }}>
              <span className="text-[22px] font-bold leading-none" style={{ color: ACCENT }}>&ldquo;</span>
            </div>

            <div className="pl-5 border-l border-white/25">
              <h2 className="text-white font-bold tracking-tight leading-[0.95] text-[52px]">Run the<br />whole show.</h2>

              <p className="text-white/70 text-[14px] leading-relaxed mt-8 max-w-[330px]">
                &ldquo;Every post, every platform, every teammate — on one board. Plan it, hand it off, watch it go live.&rdquo;
              </p>

              <div className="flex items-center gap-3 mt-7">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>ME</div>
                <div>
                  <div className="text-white text-[13.5px] font-semibold leading-tight">Maheen Ejaz</div>
                  <div className="text-white/60 text-[12px]">Co-founder &amp; CMO</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
