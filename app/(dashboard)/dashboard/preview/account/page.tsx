"use client";
import { useEffect, useState } from "react";
import { confirmDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { ThemeToggle } from "@/components/Theme";
import {
  IconUser, IconMail, IconId, IconBriefcase, IconLock, IconShieldCheck, IconSend, IconCheck, IconPencil, IconEye, IconCamera, IconPalette,
} from "@tabler/icons-react";

type Me = { name?: string; first?: string; initials?: string; role?: string; email?: string; id?: string; isAdmin?: boolean; photoUrl?: string | null } | null;

export default function AccountPage() {
  return (
    <PreviewDashboardShell
      active="account"
      title="My Account"
      subtitle="Your profile and sign-in — review your details and change your password."
      hideAccountPicker
      hideRange
    >
      {() => <Inner />}
    </PreviewDashboardShell>
  );
}

function Inner() {
  const [me, setMe] = useState<Me>(null);
  // Admins can open a teammate's account as they see it: /account?user=nandu (used by
  // the Comments page so a comment opens on the commenter's own view).
  const [viewing, setViewing] = useState<Me>(null);
  const [viewErr, setViewErr] = useState<string | null>(null);
  const load = () => fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).then((d) => d?.user ?? null);
  useEffect(() => {
    let alive = true;
    load().then(async (u) => {
      if (!alive) return;
      setMe(u);
      const want = new URLSearchParams(window.location.search).get("user");
      if (!want || !u?.isAdmin || want === u.id) return;
      try {
        const j = await (await fetch("/api/admin/team", { cache: "no-store" })).json();
        const t = (j.team || []).find((x: { id: string }) => x.id === want);
        if (alive) (t ? setViewing(t) : setViewErr(`No team member "${want}".`));
      } catch { if (alive) setViewErr("Couldn't load that account."); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const shown = viewing || me;
  return (
    <div className="max-w-2xl space-y-5">
      {viewing && (
        <div className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand-light px-4 py-2.5 text-[14px] text-[#232D42]">
          <IconEye size={16} stroke={1.8} className="text-brand" />
          Viewing <b className="font-medium">{viewing.name}</b>&apos;s account as they see it (admin view). <a href="?" className="ml-auto text-brand hover:underline text-[12px]">Back to mine</a>
        </div>
      )}
      {viewErr && <div className="rounded-xl bg-[#FDECEA] text-[#8a2e28] text-[14px] px-4 py-2.5">{viewErr}</div>}
      <Profile me={shown} editable={!viewing} onSaved={(u) => setMe((m) => (m ? { ...m, ...u } : m))}
        // Photo: your own, or anyone's when an admin is viewing their account.
        photo={<PhotoPicker person={shown} forUser={viewing?.id} onChanged={(url) => (viewing ? setViewing((v) => (v ? { ...v, photoUrl: url } : v)) : setMe((m) => (m ? { ...m, photoUrl: url } : m)))} />} />
      {!viewing && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-light text-brand"><IconPalette size={17} stroke={1.8} /></span>
            <h2 className="text-sm font-semibold text-[#232D42]">Appearance</h2>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-[#8A92A6]">System follows your computer&apos;s light/dark setting. Saved to your account, so it follows you to any device.</p>
            <ThemeToggle />
          </div>
        </div>
      )}
      {!viewing && <ChangePassword hasEmail={!!me?.email} />}
    </div>
  );
}

// Name and job title are the person's own to edit; email, username and access are
// set by an admin on the Team page (email/username are what they sign in with).
function Profile({ me, editable, onSaved, photo }: { me: Me; editable: boolean; onSaved: (u: { name?: string; role?: string }) => void; photo?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = () => { setName(me?.name || ""); setRole(me?.role || ""); setErr(null); setEditing(true); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, role }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't save."); return; }
      onSaved({ name: j.name, role: j.role }); setEditing(false);
    } finally { setBusy(false); }
  };
  const field = "mt-1 w-full h-9 border border-gray-200 rounded px-3 text-[14px] outline-none focus:border-brand";
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-light text-brand"><IconUser size={17} stroke={1.8} /></span>
        <h2 className="text-sm font-semibold text-[#232D42]">Profile</h2>
        {me?.isAdmin && <span className="text-[11px] font-medium bg-brand-light text-brand rounded-full px-2.5 py-1">Admin</span>}
        {editable && !editing && (
          <button onClick={start} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded border border-gray-200 text-[14px] text-[#4A5468] hover:border-brand hover:text-brand">
            <IconPencil size={15} stroke={1.8} />Edit
          </button>
        )}
      </div>
      {photo}
      {editing ? (
        <div className="space-y-3">
          <label className="block text-[12px] text-[#8A92A6]">Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} autoFocus />
          </label>
          <label className="block text-[12px] text-[#8A92A6]">Job title
            <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} placeholder="e.g. Senior Video Editor" className={field} />
          </label>
          <p className="text-[12px] text-[#8A92A6]">Email and username are set by an admin — they&apos;re what you sign in with.</p>
          {err && <div className="rounded bg-[#FDECEA] text-[#8a2e28] text-[14px] px-3 py-2">{err}</div>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy || name.trim().length < 2}
              className="h-9 px-4 rounded bg-brand text-white text-[14px] font-medium hover:bg-[#2138B0] disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditing(false)} className="h-9 px-3 text-[14px] text-[#8A92A6] hover:text-[#232D42]">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <Row icon={IconUser} label="Name" value={me?.name} />
          <Row icon={IconMail} label="Email" value={me?.email} />
          <Row icon={IconId} label="Username" value={me?.id} />
          <Row icon={IconBriefcase} label="Job title" value={me?.role} />
        </>
      )}
    </div>
  );
}

// Profile picture: shown wherever initials were. Picked here, cropped to a centred
// square and resized to 256×256 JPEG in the browser, then uploaded.
function PhotoPicker({ person, forUser, onChanged }: { person: Me; forUser?: string; onChanged: (url: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) { setErr("Pick a JPG, PNG or WebP image."); return; }
    setBusy(true);
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas"); c.width = c.height = 256;
      c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(img.src);
      const r = await fetch("/api/account/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: c.toDataURL("image/jpeg", 0.85), userId: forUser }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't upload it."); return; }
      onChanged(j.photoUrl);
    } catch { setErr("Couldn't read that image — try a JPG or PNG."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setErr(null);
    if (!(await confirmDialog({ title: "Remove the profile photo?", action: "Remove", cancel: "Cancel", danger: true }))) { setBusy(false); return; }
    const r = await fetch("/api/account/photo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: forUser }) });
    setBusy(false);
    if (r.ok) onChanged(null); else setErr("Couldn't remove it.");
  };
  return (
    <div className="flex items-center gap-4 pb-4 mb-2 border-b border-gray-100">
      {person?.photoUrl
        ? <img src={person.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover bg-[#F6F7FB]" loading="lazy" decoding="async" />
        : <span className="w-16 h-16 rounded-full bg-brand-light text-brand grid place-items-center text-[20px] font-medium">{person?.initials || "?"}</span>}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <label className={`inline-flex items-center gap-1.5 h-9 px-3 rounded border border-gray-200 text-[14px] text-[#4A5468] hover:border-brand hover:text-brand cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
            <IconCamera size={15} stroke={1.8} />{busy ? "Uploading…" : person?.photoUrl ? "Change photo" : "Add photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {person?.photoUrl && <button onClick={remove} disabled={busy} className="h-9 px-3 text-[14px] text-[#8A92A6] hover:text-rose-600 disabled:opacity-50">Remove</button>}
        </div>
        <span className="text-[12px] text-[#8A92A6]">Shown next to your name around the dashboard. Square photos work best.</span>
        {err && <span className="text-[12px] text-rose-600">{err}</span>}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof IconUser; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={16} stroke={1.7} className="text-gray-400 shrink-0" />
      <span className="text-xs text-[#8A92A6] w-24 shrink-0">{label}</span>
      <span className="text-sm text-[#232D42] font-medium truncate">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}

function ChangePassword({ hasEmail }: { hasEmail: boolean }) {
  const [step, setStep] = useState<"enter" | "verify" | "done">("enter");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const valid = pw.length >= 8 && pw === pw2;

  const sendCode = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await fetch("/api/account/otp", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Couldn't send the code.");
      setSentTo(d.sentTo || null);
      setStep("verify");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the code."); }
    finally { setBusy(false); }
  };

  const change = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await fetch("/api/account/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, newPassword: pw }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Couldn't change the password.");
      setStep("done");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't change the password."); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-light text-brand"><IconLock size={17} stroke={1.8} /></span>
        <h2 className="text-sm font-semibold text-[#232D42]">Change password</h2>
      </div>

      {step === "done" ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
          <IconCheck size={16} stroke={2} /> Your password has been changed. Use it the next time you sign in.
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#8A92A6]">New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={step === "verify"} placeholder="At least 8 characters"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
          </div>
          <div>
            <label className="text-xs text-[#8A92A6]">Confirm new password</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={step === "verify"} placeholder="Re-enter the password"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
            {pw2 && pw !== pw2 && <p className="text-[11px] text-rose-600 mt-1">Passwords don&apos;t match.</p>}
          </div>

          {step === "enter" ? (
            <button
              onClick={sendCode}
              disabled={!valid || busy || !hasEmail}
              title={!hasEmail ? "No email on file — ask an admin to add one" : undefined}
              className="inline-flex items-center gap-2 text-sm font-medium text-white bg-brand rounded-lg px-4 py-2 hover:bg-[#2138B0] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <IconSend size={15} stroke={1.9} /> {busy ? "Sending…" : "Email me a verification code"}
            </button>
          ) : (
            <div className="pt-1 space-y-3">
              <div className="flex items-center gap-2 text-[12px] text-[#8A92A6] bg-brand-light/50 border border-gray-100 rounded-lg px-3 py-2">
                <IconShieldCheck size={15} className="text-brand" stroke={1.8} /> We emailed a 6-digit code to <b className="text-[#232D42]">{sentTo}</b>. Enter it below (expires in 10 minutes).
              </div>
              <div>
                <label className="text-xs text-[#8A92A6]">Verification code</label>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code"
                  className="mt-1 w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm tracking-[0.3em] font-medium" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={change} disabled={code.length !== 6 || busy}
                  className="inline-flex items-center gap-2 text-sm font-medium text-white bg-brand rounded-lg px-4 py-2 hover:bg-[#2138B0] disabled:opacity-40 disabled:cursor-not-allowed">
                  <IconCheck size={15} stroke={2} /> {busy ? "Changing…" : "Change password"}
                </button>
                <button onClick={sendCode} disabled={busy} className="text-[12px] text-brand hover:underline disabled:opacity-40">Resend code</button>
              </div>
            </div>
          )}

          {err && <p className="text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</p>}
          {!hasEmail && step === "enter" && (
            <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">No email is on file for your account, so we can&apos;t send a code. Ask an admin to add your email on the Team page.</p>
          )}
        </div>
      )}
    </div>
  );
}
