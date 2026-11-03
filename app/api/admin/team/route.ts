import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { fetchRoster, rosterById, invalidateRosterCache, syncHubMember, endSessions } from "@/lib/team-db";
import { TEAM_ROLES } from "@/lib/team-roles";
import { getSupabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/passwords";
import { cleanPermissions, cleanSections, canManageAccess } from "@/lib/permissions";
import { sendMail, hasEmail, maskEmail } from "@/lib/email";
import { INVITE_TTL_MS, inviteKey, newCode } from "@/lib/invites";

// Admin-only management of the team roster (Supabase `ind_users`).
// GET   → the roster (no password hashes, just a has-password flag)
// PATCH → { id, updates: { email?, name?, first?, initials?, role?, is_admin?, active? } }
// POST  → { action: "set_password" | "clear_password" | "add", ... }
//
// Notes for future-us:
// - Admin/role changes take effect at the person's NEXT login (the admin flag lives
//   in the signed session cookie, minted at login).
// - Deactivating blocks new logins; an already-open session stays valid until it expires.

const MIN_PASSWORD_LEN = 8;

// Only people with the "Can change access" switch may read or change the team
// (Praveen, 22 Oct). Safety net: if nobody active has that switch, admins may — so a
// slip can never lock everyone out of this page.
async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; res: NextResponse }> {
  const uid = getSessionUserId();
  const me = await rosterById(uid);
  const roster = await fetchRoster(true);
  const anyManager = roster.some((u) => u.active && canManageAccess(u));
  if (!me || !(canManageAccess(me) || (!anyManager && me.isAdmin))) {
    return { ok: false, res: NextResponse.json({ error: "Only the people who manage access can change it", locked: true }, { status: 403 }) };
  }
  return { ok: true, adminId: me.id };
}

function db() {
  const sb = getSupabase();
  if (!sb) {
    return {
      sb: null,
      res: NextResponse.json({ error: "Supabase not configured on this server" }, { status: 503 }),
    };
  }
  return { sb, res: null };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const roster = await fetchRoster(true);
  return NextResponse.json({
    me: gate.adminId,
    team: roster.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      first: u.first,
      initials: u.initials,
      role: u.role,
      isAdmin: u.isAdmin,
      active: u.active,
      hasPassword: u.hasPassword,
      permissions: u.permissions,
      sections: u.sections,
      photoUrl: u.photoUrl,
      // Role in the workflow + shift start live on mh_team_members (sql/038).
      workRole: TEAM_ROLES[u.id]?.role ?? null,
      shiftStart: TEAM_ROLES[u.id]?.shiftStart ?? "09:00",
      editPartner: TEAM_ROLES[u.id]?.editPartner ?? null,
    })),
  });
}

const PATCHABLE = ["email", "name", "first", "initials", "role", "is_admin", "active", "permissions", "sections"] as const;

export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const { sb, res } = db();
  if (!sb) return res!;

  let body: { id?: string; updates?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch {}
  const id = typeof body.id === "string" ? body.id : "";
  const raw = body.updates ?? {};
  const updates: Record<string, unknown> = {};
  for (const k of PATCHABLE) {
    if (k in raw) updates[k] = k === "permissions" ? cleanPermissions(raw[k]) : k === "sections" ? cleanSections(raw[k]) : raw[k];
  }
  // Role in the workflow and shift start are stored on mh_team_members, not ind_users.
  const hub: Record<string, string | null> = {};
  if ("workRole" in raw) {
    if (!["writer", "designer", "editor", "manager"].includes(String(raw.workRole))) {
      return NextResponse.json({ error: "Pick Writer, Designer, Editor or Manager." }, { status: 400 });
    }
    hub.role = String(raw.workRole);
  }
  if ("shiftStart" in raw) {
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(raw.shiftStart))) {
      return NextResponse.json({ error: "Shift start must be a time like 09:00." }, { status: 400 });
    }
    hub.shift_start = String(raw.shiftStart);
  }
  // The on-camera pair (sql/039): "" clears it; never yourself.
  if ("editPartner" in raw) {
    const p = String(raw.editPartner || "").toLowerCase();
    if (p && (p === id || !(await rosterById(p)))) {
      return NextResponse.json({ error: "Pick someone else on the team as the edit partner." }, { status: 400 });
    }
    hub.edit_partner = p || null;
  }
  if (id && Object.keys(hub).length && Object.keys(updates).length === 0) {
    const { error } = await sb.from("mh_team_members").update(hub).eq("key", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateRosterCache();
    return NextResponse.json({ ok: true });
  }
  if (!id || Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Need id and at least one field" }, { status: 400 });
  }
  // Don't let an admin lock themselves out.
  if (id === gate.adminId && (updates.is_admin === false || updates.active === false)) {
    return NextResponse.json(
      { error: "You can't remove your own admin access or deactivate yourself." },
      { status: 400 },
    );
  }
  // Nor take away their own "Can change access", or the last one anyone has.
  const target = await rosterById(id);
  if ("permissions" in updates && canManageAccess(target) && (updates.permissions as { manage_access?: boolean }).manage_access !== true) {
    if (id === gate.adminId) {
      return NextResponse.json({ error: "You can't take away your own Can change access." }, { status: 400 });
    }
    const others = (await fetchRoster(true)).filter((u) => u.id !== id && u.active && canManageAccess(u));
    if (!others.length) {
      return NextResponse.json({ error: "Someone has to keep Can change access." }, { status: 400 });
    }
  }
  if ("email" in updates && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(updates.email))) {
    return NextResponse.json({ error: "That doesn't look like an email." }, { status: 400 });
  }

  const { error } = await sb.from("ind_users").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (Object.keys(hub).length) {
    const { error: hErr } = await sb.from("mh_team_members").update(hub).eq("key", id);
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  }
  invalidateRosterCache();
  // Switched off: end their open sessions too.
  if (updates.active === false) await endSessions(id).catch(() => {});
  // Keep the Marketing Hub's copy in step (name, email, switched on/off).
  if ("name" in updates || "email" in updates || "active" in updates) {
    try { await syncHubMember(id); } catch (e) { console.error("[team] hub sync", e); }
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const { sb, res } = db();
  if (!sb) return res!;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action ?? "");

  if (action === "set_password") {
    const id = String(body.id ?? "");
    const password = typeof body.password === "string" ? body.password : "";
    if (!id) return NextResponse.json({ error: "Need id" }, { status: 400 });
    if (password.length < MIN_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
        { status: 400 },
      );
    }
    const { error } = await sb
      .from("ind_users")
      .update({ password_hash: hashPassword(password) })
      .eq("id", id);
    if (error) {
      // Most likely: sql/005_per_user_passwords.sql hasn't been run yet.
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    invalidateRosterCache();
    return NextResponse.json({ ok: true });
  }

  if (action === "clear_password") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Need id" }, { status: 400 });
    const { error } = await sb.from("ind_users").update({ password_hash: null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateRosterCache();
    return NextResponse.json({ ok: true });
  }

  if (action === "add") {
    const id = String(body.id ?? "").trim().toLowerCase();
    const email = String(body.email ?? "").trim();
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "").trim() || "Team member";
    if (!/^[a-z0-9][a-z0-9-]{1,19}$/.test(id)) {
      return NextResponse.json(
        { error: "Short id must be 2–20 chars: lowercase letters, numbers, dashes (e.g. \"asha\")." },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "That doesn't look like an email." }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "Need a name" }, { status: 400 });
    const first = String(body.first ?? "").trim() || name.split(/\s+/)[0];
    const initials =
      String(body.initials ?? "").trim().toUpperCase() ||
      name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

    const { error } = await sb.from("ind_users").insert({
      id, email, name, first, initials, role, is_admin: false, active: true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateRosterCache();
    // Without this they can sign in but can't be given a task (sql FK → mh_team_members).
    try { await syncHubMember(id); } catch (e) {
      return NextResponse.json({ ok: true, warning: `Added, but not yet to the Marketing Hub: ${(e as Error).message}` });
    }
    return NextResponse.json({ ok: true });
  }

  // Email someone their way in. Deliberately does NOT send a password: they get a
  // one-time code and choose their own, so an intercepted email is useless on its
  // own and no reusable secret is ever written down.
  if (action === "invite") {
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "Need id" }, { status: 400 });

    const person = await rosterById(id);
    if (!person) return NextResponse.json({ error: "No such person." }, { status: 404 });
    if (!person.email) {
      return NextResponse.json({ error: `${person.first || person.name} has no email on file — add one first.` }, { status: 400 });
    }
    if (!(await hasEmail())) {
      return NextResponse.json(
        { error: "Email isn't set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local (Google Account -> Security -> 2-Step Verification -> App passwords)." },
        { status: 503 },
      );
    }

    const code = newCode();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    const { error: sErr } = await sb.from("discover_cache").upsert(
      { cache_key: inviteKey(id), source: "invite_otp", last_fetched: new Date().toISOString(), payload: { codeHash: hashPassword(code), expiresAt } },
      { onConflict: "cache_key" },
    );
    if (sErr) return NextResponse.json({ error: "Couldn't create the invite — try again." }, { status: 502 });

    const base = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
    const link = `${base}/invite`;
    const who = person.first || person.name || "there";
    try {
      await sendMail({
        to: person.email,
        subject: "Your GooCampus dashboard access",
        text: [
          `Hi ${who},`, "",
          "You've been given access to the GooCampus Marketing dashboard.", "",
          `1. Go to ${link}`,
          `2. Enter this email: ${person.email}`,
          `3. Enter this code: ${code}`,
          "4. Choose your own password", "",
          "The code expires in 24 hours. If you weren't expecting this, ignore this email.", "",
          "- GooCampus Dashboard",
        ].join("\n"),
        html: `<div style="font-family:Inter,Arial,sans-serif;color:#232D42;line-height:1.6">
          <p>Hi ${who},</p>
          <p>You've been given access to the <b>GooCampus Marketing dashboard</b>.</p>
          <p style="margin:18px 0"><a href="${link}" style="background:#3A57E8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Set up your access</a></p>
          <p>Use <b>${person.email}</b> and this code:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px;color:#3A57E8;margin:8px 0">${code}</p>
          <p>You'll choose your own password on the next screen.</p>
          <p style="color:#8A92A6;font-size:13px">The code expires in 24 hours. If you weren't expecting this, you can ignore this email.</p>
          <p style="color:#8A92A6;font-size:13px">- GooCampus Dashboard</p>
        </div>`,
      });
    } catch {
      return NextResponse.json({ error: "Couldn't send the email - check the mail settings and try again." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sentTo: maskEmail(person.email) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
