import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { getSessionIsAdmin } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { fetchRoster } from "@/lib/team-db";
import { defaultApproverEmails } from "@/lib/date-approvals";

// GET → who gets the date-change approval emails (Approvals page, 4 Nov 2026):
// { emails, saved, team: [{ name, email }], canEdit }. Saving is PATCH /api/settings
// { key: "approvalEmails", value: [...] } (admins only), like the Rules page.
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSection("content");
  if (denied) return denied;
  const sb = getSupabase();
  const { data } = sb ? await sb.from("mh_settings").select("value").eq("key", "approvalEmails").maybeSingle() : { data: null };
  const saved = Array.isArray(data?.value) ? (data!.value as string[]) : null;
  const team = (await fetchRoster()).filter((u) => u.active && u.email).map((u) => ({ name: u.name || u.first || u.id, email: u.email.toLowerCase() }));
  return NextResponse.json({ emails: saved && saved.length ? saved : await defaultApproverEmails(), saved: !!(saved && saved.length), team, canEdit: getSessionIsAdmin() });
}
