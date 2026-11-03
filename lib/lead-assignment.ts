// Leads per day — the Sales Hub's lead board.
//
// One question per level, which is why this returns one cross-tab rather than a
// pile of separate aggregates:
//
//   1. how many leads arrived each day, and who got them   → `rows`
//   2. which leads arrived on a given day                  → `leads`, filtered client-side
//   3. what happened to one of them                        → /api/leads-crm/lead-track
//
// ASSUMPTION worth knowing: the CRM has no explicit "assigned on" timestamp — the
// round-robin assigns at creation — so **Created Date is treated as the assignment
// date**. If assignment ever decouples from creation, this needs a real field.

import {
  airtableList,
  dateRangeFormula,
  pickName,
  pickNumber,
  CRM_TABLE,
  COUNSELLORS_TABLE,
  PRIMARY_INTERESTS_TABLE,
  LEAD_DISTRIBUTION_BASE,
  DISTRIBUTION_MASTERSHEET,
  idleDays,
} from "./sales-hub";
import { getSupabase } from "./supabase";

// No CRM activity in this many days = the lead has gone cold.
export { CLOSED_STATUSES, isClosedStatus } from "./lead-status";

const COLD_AFTER_DAYS = 7;

// Holding leads is not the same as selling. Six people appear in the CRM's
// Counsellor field; two of them actually call. The rest are the holding pool
// (Maheen — where leads park before distribution), a partner router (Arun, who
// passes leads to an external partner rather than calling them), and legacy
// holders. Treating "has leads" as "is a counsellor" made every number wrong.
//
// A role decides how someone is counted. Roles live in Supabase, not in this file
// and not in Airtable, so when Arun starts calling you change his role in the UI
// and he becomes a counsellor everywhere — columns, alerts, transfer targets — with
// no code change and no edit to the CRM.
export type Role = "counsellor" | "pool" | "partner" | "inactive";

export const ROLE_LABEL: Record<Role, string> = {
  counsellor: "Counsellor",
  pool: "Holding pool",
  partner: "Partner router",
  inactive: "Inactive",
};

// Used until someone sets a role explicitly, and as the fallback if the roles
// table hasn't been created yet.
export const DEFAULT_ROLES: Record<string, Role> = {
  "Robin Johnson J": "counsellor",
  "Jeswin Shaju": "counsellor",
  "Maheen Ejaz": "pool",
  "Arun Kannan": "partner",
  "Alfiya Naaz": "inactive",
  "Ralph Leander D Cruz": "inactive",
};

// Anyone holding leads who has never been given a role. Treated as inactive for
// counting, but surfaced in the Roles tab so they can be classified.
export const UNCLASSIFIED: Role = "inactive";

export async function getRoles(): Promise<Record<string, Role>> {
  const db = getSupabase();
  if (!db) return { ...DEFAULT_ROLES };
  const { data, error } = await db.from("lead_roles").select("holder, role");
  // Missing table = the migration hasn't been run; defaults still give a correct
  // board, so this degrades quietly rather than blanking the page.
  if (error || !data) return { ...DEFAULT_ROLES };
  const out: Record<string, Role> = { ...DEFAULT_ROLES };
  for (const r of data as { holder: string; role: string }[]) {
    if (r.holder) out[r.holder] = (r.role as Role) || UNCLASSIFIED;
  }
  return out;
}

// Airtable collaborator cells arrive as { id, name, email }. pickName() gives the
// label; transfers need the user id too.
export function pickUser(v: unknown): { id: string; name: string; email: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = Array.isArray(v) ? (v[0] as Record<string, unknown>) : (v as Record<string, unknown>);
  if (!o || typeof o.id !== "string") return null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : "",
    email: typeof o.email === "string" ? o.email : "",
  };
}

// `inRoster: false` = holds leads but isn't in the Counsellors table. They still
// need to be a valid transfer target, otherwise a lead sitting with someone
// off-roster can never be moved from here.
export type RosterEntry = { name: string; userId: string; email: string; label: string; inRoster: boolean };

export async function getCounsellorRoster(): Promise<RosterEntry[]> {
  const rows = await airtableList<Record<string, unknown>>(COUNSELLORS_TABLE, {
    fields: ["Name", "User", "Email", "Label"],
    pageSize: 100,
    maxRecords: 200,
  });
  const out: RosterEntry[] = [];
  for (const r of rows) {
    const user = pickUser(r.fields["User"]);
    const name = pickName(r.fields["Name"]) || user?.name || "";
    if (!user || !name) continue; // no Airtable user = can't be a transfer target
    out.push({
      name,
      userId: user.id,
      email: pickName(r.fields["Email"]) || user.email,
      label: pickName(r.fields["Label"]) || name,
      inRoster: true,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type BoardLead = {
  id: string;
  name: string;
  source: string;
  interest: string;
  sbu: string;              // interest → SBU (Study Abroad / UK / USA / …)
  counsellor: string;
  counsellorUserId: string;
  status: string;
  day: string;              // the bucket key it belongs to
  date: string;             // the actual IST day it arrived
  daysUntouched: number;
  cold: boolean;
  link: string;
  role: Role;
  ageDays: number;         // days since the lead arrived
  callAttempts: number;
  flaggedNew: boolean;     // assigned, still "New", no edit in >2 days
  flaggedPool: boolean;    // stuck in the pool for >2 days
};

export type BoardRow = {
  key: string;              // YYYY-MM-DD (bucket start)
  label: string;            // "19 Aug" / "04 – 10 Aug" / "August 2026"
  dow: string;              // "Wed" — empty for week/month
  total: number;
  by: Record<string, number>;
  cold: number;
};

export type InterestRow = {
  interest: string;
  total: number;
  assigned: number;      // held by a counsellor
  pool: number;          // waiting in the holding pool
  partner: number;       // routed to a partner
  other: number;         // held by someone inactive/unclassified
  newOver2: number;      // assigned, still "New", no edit in >2 days
  poolStuck: number;     // in the pool, created >2 days ago
};

export type HolderRow = {
  holder: string;
  userId: string;
  role: Role;
  total: number;
  stillNew: number;
  newOver2: number;
  idle7: number;
  neverCalled: number;
  byStatus: { key: string; n: number }[];
  byInterest: { key: string; n: number }[];
};

export type LeadBoard = {
  range: { from: string; to: string };
  bucket: Bucket;
  generated: number;        // every lead created in range, whoever holds it
  counsellors: string[];    // fixed column order for the per-day cards
  rows: BoardRow[];         // newest bucket first
  totals: { total: number; by: Record<string, number>; cold: number };
  roster: RosterEntry[];
  leads: BoardLead[];       // counsellor-held only — powers the per-day drill-down
  allLeads: BoardLead[];    // every lead, for Transfer and the tracker
  interests: InterestRow[];
  holders: HolderRow[];
  alerts: { newOver2: number; poolStuck: number; poolStuck15: number };
  roles: Record<string, Role>;
};

// The two rules the team asked for.
const NEW_ALERT_DAYS = 2;   // assigned + still "New" + no edit in this many days
const POOL_ALERT_DAYS = 2;  // sitting in the pool this long without being assigned

export type Bucket = "day" | "week" | "month";

const CRM_FIELDS = [
  "Full Name", "Created Date", "Counsellor", "Lead Status",
  "Lead Source (n8n)", "Primary Interest (n8n)", "Days Untouched", "Actual Last Modified", "Call Attempts", "Link to Record",
];

// Leads with no counsellor still have to appear somewhere, or the row totals stop
// adding up and the table quietly lies.
const UNASSIGNED = "Unassigned";

// Airtable returns Created Date as a UTC instant. Slicing the ISO string would
// bucket a lead created 00:30 IST into the PREVIOUS day, because IST is UTC+5:30 —
// so a night-time lead silently lands in yesterday's column. The team works in IST,
// so every bucket is computed in IST.
const IST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

function istDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return IST.format(d);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shortDate(day: string): string {
  const [, m, d] = day.split("-");
  return `${d} ${MON[Number(m) - 1].slice(0, 3)}`;
}

// Bucket a day into its group key + display label. Weeks are Monday-anchored, which
// is how the team talks about "this week".
function bucketOf(day: string, bucket: Bucket): { key: string; label: string; dow: string } {
  if (bucket === "month") {
    const [y, m] = day.split("-");
    return { key: `${y}-${m}-01`, label: `${MON[Number(m) - 1]} ${y}`, dow: "" };
  }
  if (bucket === "week") {
    const d = new Date(`${day}T00:00:00Z`);
    const offset = (d.getUTCDay() + 6) % 7; // Mon = 0
    d.setUTCDate(d.getUTCDate() - offset);
    const start = d.toISOString().slice(0, 10);
    const end = new Date(d);
    end.setUTCDate(end.getUTCDate() + 6);
    return { key: start, label: `${shortDate(start)} – ${shortDate(end.toISOString().slice(0, 10))}`, dow: "" };
  }
  const d = new Date(`${day}T00:00:00Z`);
  return { key: day, label: shortDate(day), dow: DOW[d.getUTCDay()] };
}

// Primary Interest → SBU (Study Abroad / UK / USA / India UG / …) from the
// DB: Primary Interests table. Cheap (~24 rows); best-effort — an interest that
// isn't mapped falls back to "Other".
export async function getSbuMap(): Promise<Map<string, string>> {
  try {
    const rows = await airtableList<Record<string, unknown>>(PRIMARY_INTERESTS_TABLE, {
      fields: ["Particulars", "SBU"], pageSize: 100, maxRecords: 200,
    });
    const m = new Map<string, string>();
    for (const r of rows) {
      const name = pickName(r.fields["Particulars"]);
      const sbu = pickName(r.fields["SBU"]);
      if (name && sbu) m.set(name, sbu);
    }
    return m;
  } catch { return new Map(); }
}

// ── Assignment log (the Telegram source of truth) ──────────────────────────
//
// The Lead Distribution "Mastersheet" is written by the n8n round-robin workflow
// the instant a lead is handed to a counsellor, and its 11:59 PM IST job reads
// exactly this table to build each counsellor's Telegram daily summary. Counting
// from here (keyed on the real "Assigned Time") makes the Per-day tab match that
// Telegram to the lead, instead of approximating with the CRM's Created Date.

export type AssignmentRow = { key: string; label: string; dow: string; total: number; by: Record<string, number> };
export type AssignmentBoard = {
  range: { from: string; to: string };
  bucket: Bucket;
  counsellors: string[];        // columns, busiest first
  rows: AssignmentRow[];        // newest bucket first
  totals: { total: number; by: Record<string, number> };
  byInterest: { counsellor: string; interest: string; n: number }[];
  source: "assignment-log";
};

const MON_ABBR: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "09 Jul 2026, 02:32 PM" → "2026-07-09". Already IST (n8n writes it in
// Asia/Kolkata), so no timezone maths — just reshape the string.
function assignedTimeToDay(s: string): string | null {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(String(s || ""));
  if (!m) return null;
  const mon = MON_ABBR[m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

export async function getAssignmentLog(from: string, to: string, bucket: Bucket): Promise<AssignmentBoard> {
  const rows = await airtableList<Record<string, unknown>>(DISTRIBUTION_MASTERSHEET, {
    baseId: LEAD_DISTRIBUTION_BASE,
    fields: ["Counsellor", "Primary Interest", "Assigned Time"],
    pageSize: 100,
    maxRecords: 50_000,
  });

  const rowMap = new Map<string, AssignmentRow>();
  const totalsBy: Record<string, number> = {};
  const interestMap = new Map<string, number>(); // `${counsellor}${interest}` → n
  let total = 0;

  for (const rec of rows) {
    const day = assignedTimeToDay(pickName(rec.fields["Assigned Time"]));
    if (!day || day < from || day > to) continue;
    const counsellor = pickName(rec.fields["Counsellor"]) || UNASSIGNED;
    const interest = pickName(rec.fields["Primary Interest"]) || "No Primary Interest";
    const b = bucketOf(day, bucket);
    let row = rowMap.get(b.key);
    if (!row) { row = { key: b.key, label: b.label, dow: b.dow, total: 0, by: {} }; rowMap.set(b.key, row); }
    row.total++;
    row.by[counsellor] = (row.by[counsellor] || 0) + 1;
    totalsBy[counsellor] = (totalsBy[counsellor] || 0) + 1;
    const ik = `${counsellor}|::|${interest}`;
    interestMap.set(ik, (interestMap.get(ik) || 0) + 1);
    total++;
  }

  const rowsOut = [...rowMap.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const counsellors = Object.keys(totalsBy).sort((a, b) => (totalsBy[b] - totalsBy[a]) || a.localeCompare(b));
  const byInterest = [...interestMap.entries()]
    .map(([k, n]) => { const [counsellor, interest] = k.split("|::|"); return { counsellor, interest, n }; })
    .sort((a, b) => b.n - a.n);

  return { range: { from, to }, bucket, counsellors, rows: rowsOut, totals: { total, by: totalsBy }, byInterest, source: "assignment-log" };
}

export async function getLeadBoard(from: string, to: string, bucket: Bucket): Promise<LeadBoard> {
  const [leadRows, roster, roles, sbuMap] = await Promise.all([
    airtableList<Record<string, unknown>>(CRM_TABLE, {
      filterByFormula: dateRangeFormula("Created Date", from, to),
      fields: CRM_FIELDS,
      pageSize: 100,
      maxRecords: 20_000,
    }),
    getCounsellorRoster(),
    getRoles(),
    getSbuMap(),
  ]);

  const roleOf = (holder: string): Role => roles[holder] || UNCLASSIFIED;

  const leads: BoardLead[] = [];        // counsellor-held — the per-day cards
  const allLeads: BoardLead[] = [];     // everything — Transfer + tracker
  const rowMap = new Map<string, BoardRow>();
  const volume = new Map<string, number>();
  const totalsBy: Record<string, number> = {};
  const interestMap = new Map<string, InterestRow>();
  const holderMap = new Map<string, HolderRow>();
  const statusBy = new Map<string, Map<string, number>>();
  const interestBy = new Map<string, Map<string, number>>();
  let total = 0, coldTotal = 0, generated = 0;
  let alertNew = 0, alertPool = 0, alertPool15 = 0;

  for (const rec of leadRows) {
    const f = rec.fields;
    const createdIso = pickName(f["Created Date"]);
    if (!createdIso) continue;
    generated++;

    const user = pickUser(f["Counsellor"]);
    const holder = user?.name || UNASSIGNED;
    const role = user ? roleOf(holder) : "pool"; // no counsellor set = effectively unassigned
    const date = istDay(createdIso);
    const b = bucketOf(date, bucket);
    const idle = idleDays(f);
    const status = pickName(f["Lead Status"]) || "—";
    const interest = pickName(f["Primary Interest (n8n)"]) || "No Primary Interest";
    const ageDays = Math.floor((Date.now() - Date.parse(createdIso)) / 86_400_000);
    const calls = pickNumber(f["Call Attempts"]);
    const cold = idle > COLD_AFTER_DAYS;

    // The two alert rules.
    const isCounsellor = role === "counsellor";
    const flaggedNew = isCounsellor && status === "New" && idle > NEW_ALERT_DAYS;
    const flaggedPool = role === "pool" && ageDays > POOL_ALERT_DAYS;
    if (flaggedNew) alertNew++;
    if (flaggedPool) { alertPool++; if (ageDays > 14) alertPool15++; }

    const lead: BoardLead = {
      id: rec.id,
      name: pickName(f["Full Name"]) || "(no name)",
      source: pickName(f["Lead Source (n8n)"]) || "No source",
      interest,
      sbu: sbuMap.get(interest) || "Other",
      counsellor: user?.name || "",
      counsellorUserId: user?.id || "",
      status,
      day: b.key,
      date,
      daysUntouched: idle,
      cold,
      link: pickName(f["Link to Record"]),
      role,
      ageDays,
      callAttempts: calls,
      flaggedNew,
      flaggedPool,
    };
    allLeads.push(lead);

    // ── by primary interest
    let ir = interestMap.get(interest);
    if (!ir) { ir = { interest, total: 0, assigned: 0, pool: 0, partner: 0, other: 0, newOver2: 0, poolStuck: 0 }; interestMap.set(interest, ir); }
    ir.total++;
    if (isCounsellor) { ir.assigned++; if (flaggedNew) ir.newOver2++; }
    else if (role === "pool") { ir.pool++; if (flaggedPool) ir.poolStuck++; }
    else if (role === "partner") ir.partner++;
    else ir.other++;

    // ── by holder
    let hr = holderMap.get(holder);
    if (!hr) {
      hr = { holder, userId: user?.id || "", role, total: 0, stillNew: 0, newOver2: 0, idle7: 0, neverCalled: 0, byStatus: [], byInterest: [] };
      holderMap.set(holder, hr);
      statusBy.set(holder, new Map());
      interestBy.set(holder, new Map());
    }
    hr.total++;
    if (status === "New") hr.stillNew++;
    if (flaggedNew) hr.newOver2++;
    if (idle > COLD_AFTER_DAYS) hr.idle7++;
    if (!(calls > 0)) hr.neverCalled++;
    const sm = statusBy.get(holder)!; sm.set(status, (sm.get(status) || 0) + 1);
    const im = interestBy.get(holder)!; im.set(interest, (im.get(interest) || 0) + 1);

    // ── per-day cards: counsellors only
    if (!isCounsellor) continue;
    let row = rowMap.get(b.key);
    if (!row) { row = { key: b.key, label: b.label, dow: b.dow, total: 0, by: {}, cold: 0 }; rowMap.set(b.key, row); }
    row.total++;
    row.by[holder] = (row.by[holder] || 0) + 1;
    if (cold) row.cold++;
    total++;
    totalsBy[holder] = (totalsBy[holder] || 0) + 1;
    if (cold) coldTotal++;
    volume.set(holder, (volume.get(holder) || 0) + 1);
    leads.push(lead);
  }

  for (const [holder, hr] of holderMap) {
    hr.byStatus = [...(statusBy.get(holder) || new Map())].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
    hr.byInterest = [...(interestBy.get(holder) || new Map())].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  }

  // Fixed order — the same people in the same places every time, so the eye
  // doesn't have to re-find a column when the range changes.
  const counsellors = Object.entries(roles)
    .filter(([, r]) => r === "counsellor")
    .map(([name]) => name)
    .filter((c) => (volume.get(c) || 0) > 0)
    .sort();

  // Anyone actually holding leads is a legitimate transfer target even if the
  // Counsellors table doesn't list them.
  const known = new Set(roster.map((r) => r.userId));
  const fullRoster: RosterEntry[] = [...roster];
  for (const l of allLeads) {
    if (l.counsellorUserId && !known.has(l.counsellorUserId)) {
      known.add(l.counsellorUserId);
      fullRoster.push({ name: l.counsellor, userId: l.counsellorUserId, email: "", label: l.counsellor, inRoster: false });
    }
  }

  return {
    range: { from, to },
    bucket,
    generated,
    counsellors,
    rows: [...rowMap.values()].sort((a, b) => (a.key < b.key ? 1 : -1)),
    totals: { total, by: totalsBy, cold: coldTotal },
    roster: fullRoster,
    leads,
    allLeads,
    interests: [...interestMap.values()].sort((a, b) => b.total - a.total),
    holders: [...holderMap.values()].sort((a, b) => b.total - a.total),
    alerts: { newOver2: alertNew, poolStuck: alertPool, poolStuck15: alertPool15 },
    roles,
  };
}
