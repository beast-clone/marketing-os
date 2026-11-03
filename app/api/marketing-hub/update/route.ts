import { NextResponse } from "next/server";
import { firstWithRole, isDesigner, isEditor, roleOf } from "@/lib/team-roles";
import { safeError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { getSessionUserId } from "@/lib/auth";
import { VIDEO_TYPES } from "@/lib/mh-content-types";
import { bustMarketingHubCache } from "@/lib/mh-cache";
import { postTeamMessage, MH_NAME } from "@/lib/mh-chat";
import { postSlack, slackTaskLink } from "@/lib/slack";
import { requireCapability, requireSection } from "@/lib/api-guard";
import { requestDateChange, supersedeDateChange } from "@/lib/date-approvals";
import { canEditCalendar, needsDateApproval, needsDateReason } from "@/lib/permissions";
import { freshPublishState } from "@/lib/scheduler-lock";
import { rosterById } from "@/lib/team-db";
import { siblingOf } from "@/lib/notifications";
import { defaultCollaboratorFor } from "@/lib/task-create";
import { rulesEngineOn } from "@/lib/rules-engine";
import { fetchRoster } from "@/lib/team-db";
import { fetchContentTypes } from "@/lib/content-types-db";

// PATCH /api/marketing-hub/update
// Updates ONE row in mh_posts (Supabase). Whitelist of fields to prevent
// clients from overwriting anything they shouldn't.

type UpdateBody = {
  id: string;
  fields: Partial<{
    particulars: string;
    type: string;
    status: string;
    sbu: string;
    owner_key: string | null;
    publishing_date: string | null;
    due_date: string | null;
    priority: string;
    platforms: string[];
    content: string;
    caption: string;
    needs_review: boolean;
    output_link: string;
    additional_info: string;
    instagram_url: string;
    facebook_url: string;
    linkedin_url: string;
    reference_links: string[];
  }>;
};

const ALLOWED_FIELDS = [
  "particulars", "type", "status", "sbu", "owner_key",
  "publishing_date", "due_date", "priority", "platforms",
  "content", "caption", "needs_review", "output_link",
  "additional_info", "instagram_url", "facebook_url", "linkedin_url",
  "reference_links", "duration_min",
] as const;

const OWNER_ALIASES: Record<string, string> = {
  "manya b m": "manya", "manya": "manya",
  "praveen l": "praveen", "praveen": "praveen",
  "nikhil shyamraj": "nikhil", "nikhi shyamraj": "nikhil", "nikhil": "nikhil",
  "nandu c": "nandu", "nandu": "nandu",
  "maheen ejaz": "maheen", "maheen": "maheen",
};

// One entry in a task's time_extensions log: the allotted minutes before and after,
// why, and — for a correction — which entry it reverses.
type TimeExtension = { fromMin: number; toMin: number; reason: string; undoOf?: string };

export async function PATCH(req: Request) {
  await fetchRoster();   // fills the shared id → name map (lib/team-names.ts) for anyone new
  await fetchContentTypes();   // registers dashboard-added types into VIDEO_TYPES (sql/028)
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  try {
    const denied = await requireCapability("edit_tasks");
    if (denied) return denied;

    const body = (await req.json()) as UpdateBody;
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (!body.fields || Object.keys(body.fields).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

    // Whitelist and normalize
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.fields)) {
      if (!(ALLOWED_FIELDS as readonly string[]).includes(k)) continue;
      if (k === "owner_key" && typeof v === "string") {
        const mapped = OWNER_ALIASES[v.toLowerCase().trim()];
        clean[k] = mapped || v; // let Postgres FK enforce if invalid
      } else {
        clean[k] = v;
      }
    }

    // Keep due_date in lockstep with publishing_date. The team tracks the publishing
    // date; a due_date left behind on an edit causes a false "overdue" (see the My Day
    // card/reminder logic). If a publishing date is set without an explicit due_date in
    // the same patch, mirror it so the two can't drift apart.
    if ("publishing_date" in clean && !("due_date" in clean)) {
      clean.due_date = clean.publishing_date;
    }

    // `custom` is a jsonb bag (collaborator / claim_role / incorporating_feedback).
    // Merge, never overwrite, so setting one key doesn't drop the others.
    const customPatch = (body.fields as { custom?: Record<string, unknown> }).custom;
    // A new entry in time_extensions means someone added (or took back) time on a
    // running task. Picked up here, where the entry actually lands, so the team hears
    // about it once — from the write itself — rather than the client having to
    // remember to announce it separately.
    let newExtension: TimeExtension | null = null;
    if (customPatch && typeof customPatch === "object" && !Array.isArray(customPatch)) {
      const { data: cur } = await sb.from("mh_posts").select("custom").eq("id", body.id).single();
      const prevLog = (cur?.custom as Record<string, unknown>)?.time_extensions;
      const nextLog = customPatch.time_extensions;
      if (Array.isArray(nextLog) && nextLog.length > (Array.isArray(prevLog) ? prevLog.length : 0)) {
        newExtension = nextLog[nextLog.length - 1] as TimeExtension;
      }
      clean.custom = { ...((cur?.custom as Record<string, unknown>) || {}), ...customPatch };
    }

    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: "no allowed fields to update" }, { status: 400 });
    }

    // Guard the mh_status enum — a non-enum value would 502 the whole update with
    // an opaque Postgres error (and two legacy client statuses used to do exactly
    // that). Reject clearly instead.
    //
    // This list MUST be exactly public.mh_status. It is a "did you send a real
    // enum value" check, not a "may you choose this one" check — permission lives
    // further down. When it drifted below the enum it did not reject bad input, it
    // quietly made good rows uneditable: three values were missing, and the 6 live
    // rows holding them (5 Rejected/Not Published, 1 Content - Needs Approval)
    // 400'd on every save, because the grid sends status back whether or not the
    // user touched it. Add here and in the enum together, or not at all.
    const VALID_STATUS = new Set([
      "Content - Pending", "Content - In Progress", "Content - Needs Approval",
      "Content - Approved", "Output - In Progress", "Incorporating Feedback",
      "Output - Ready", "Ready to Publish", "Published/Scheduled",
      "Rejected/Not Published", "Failed",
    ]);
    if (typeof clean.status === "string" && !VALID_STATUS.has(clean.status)) {
      return NextResponse.json({ error: `"${clean.status}" is not a valid status` }, { status: 400 });
    }

    // Full before-state so we can log a precise, attributed diff for every field.
    const before = await sb
      .from("mh_posts")
      .select("id, status, type, owner_key, particulars, sbu, publishing_date, due_date, priority, content, caption, additional_info, platforms, needs_review, output_link, start_at, end_at, created_at, custom, created_by, publish_status, media_urls")
      .eq("id", body.id)
      .single();
    if (before.error) throw new Error(before.error.message);

    // ── Completeness gates on status transitions (My Day workflow). Status is the
    // choke-point every surface (My Day / Master sheet / Content Review) goes through,
    // so enforcing here can't be bypassed. Returns 422 + a `missing` list the UI shows.
    const preRow = before.data as Record<string, unknown>;
    const newStatus = typeof clean.status === "string" ? (clean.status as string) : (preRow.status as string);
    const wasStatus = preRow.status as string;
    const eff = (field: string) => (field in clean ? clean[field] : preRow[field]);
    const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

    // ── Team & access switches (5 Oct) ──────────────────────────────────────
    // Edit lets you change a task; these three decide the bigger moves, and they're
    // checked here — the one place every surface writes through — not just hidden
    // in My Day. Admins pass all three (requireCapability).
    //   Assign to others: handing the task to someone else. Taking it yourself is a
    //     claim, which Edit already covers.
    //   Approve content:  moving it into Content - Approved.
    //   Change dates:     moving the publish or due date to another day.
    const me = (getSessionUserId() || "").toLowerCase();
    const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
    // Putting your OWN video back in the claim pool (owner → nobody, and back to
    // Content - Approved if it was under way) is giving work up, not handing it to
    // someone or approving anything, so neither switch applies (Nandu, 9 & 13 Oct).
    const poolRelease = "owner_key" in clean && !clean.owner_key && !!me
      && String(preRow.owner_key || "").toLowerCase() === me && VIDEO_TYPES.has(String(clean.type ?? preRow.type ?? ""))
      && (!("status" in clean) || (clean.status === "Content - Approved" && (wasStatus === "Output - In Progress" || wasStatus === "Content - Approved")));
    if ("owner_key" in clean && clean.owner_key !== preRow.owner_key && String(clean.owner_key || "").toLowerCase() !== me && !poolRelease) {
      const no = await requireCapability("assign_tasks");
      if (no) return no;
    }
    if (newStatus === "Content - Approved" && wasStatus !== "Content - Approved" && !poolRelease) {
      const no = await requireCapability("approve_content");
      if (no) return no;
    }
    // Giving a dateless task its FIRST date isn't moving it — tasks can now be created
    // with just a name (Manya, 12 Oct) — so it needs neither this switch nor Maheen.
    const firstDate = !preRow.publishing_date;
    if (("publishing_date" in clean && !firstDate && day(clean.publishing_date) !== day(preRow.publishing_date))
      || ("due_date" in clean && "due_date" in body.fields && day(clean.due_date) !== day(preRow.due_date))) {
      const no = await requireCapability("reschedule");
      if (no) return no;
      // A calendar drag also needs "Edit calendar" (Team & access) — checked here,
      // not only by hiding the drag (27 Oct wiring audit, A4).
      if ((body as { source?: string }).source === "calendar" && !canEditCalendar(await rosterById(me))) {
        return NextResponse.json({ error: "Your access doesn't include \"Edit calendar\" — ask an admin to switch it on in Team & access." }, { status: 403 });
      }
    }
    // "Ask why when a date moves" is enforced here, not only on screen, so no path
    // skips it — planner drag, the Claude connector, older pages (22 Oct review).
    if ("publishing_date" in clean && !firstDate && day(clean.publishing_date) !== day(preRow.publishing_date)
      && needsDateReason(await rosterById(me)) && !String((body as { reason?: string }).reason || "").trim()) {
      return NextResponse.json({ error: "Add a short reason for moving the date — it's saved in the task's history.", gate: "reason" }, { status: 422 });
    }
    // A post the publisher is sending can't have its caption or settings changed
    // mid-way; one waiting in the queue drops any upload made with the old caption
    // (it is baked into the Instagram upload) so the new one goes out.
    const ps = preRow.publish_status as string | null;
    if (ps === "publishing" && ("caption" in clean || "custom" in clean)) {
      return NextResponse.json({ error: "It's being published right now — wait a minute, then try again.", publishing: true }, { status: 409 });
    }
    if ("caption" in clean && (clean.caption ?? "") !== (preRow.caption ?? "") && ps && ps !== "published") {
      clean.custom = freshPublishState(clean.custom ?? preRow.custom);
    }

    // A) Content-Approved: the brief must be complete before it hands off to a producer.
    // Only on the way FORWARD. A task stepping back from production — most often an
    // accidental start being put back — is not being approved: it was approved once
    // already and nothing about the brief has changed. Re-running the gate there made
    // "put it back" impossible on any task whose brief had since lost a required field
    // (a removed collaborator was enough), leaving it stuck In Progress with no way out.
    const APPROVAL_COMES_FROM = new Set(["Content - Pending", "Content - In Progress", "Incorporating Feedback"]);
    if (newStatus === "Content - Approved" && wasStatus !== "Content - Approved" && APPROVAL_COMES_FROM.has(wasStatus)) {
      const missing: string[] = [];
      if (!filled(eff("content")) && !filled(eff("caption"))) missing.push("Content (the brief)");
      if (!filled(eff("sbu"))) missing.push("SBU");
      if (!filled(eff("priority"))) missing.push("Priority");
      if (!filled(eff("publishing_date"))) missing.push("Publishing date");
      // Deliberately NOT requiring a collaborator.
      //
      // This gate is about the BRIEF being complete before it reaches a producer —
      // the content, which SBU, how urgent, when it publishes. Who works on it is
      // not part of the brief; it is decided by the auto-handoff further down this
      // same request, which assigns design work to Praveen and drops video into the
      // editors' pool.
      //
      // Requiring one here made that circular: you had to already have a
      // collaborator to run the step that adds collaborators. For video it could
      // never be satisfied at all, because the handoff leaves video unassigned on
      // purpose — "up for grabs in the editors' pool" — so every video task had to
      // have somebody added by hand first, for no reason the workflow asks for.
      // "It is not allowing me to approve the task until I manually add
      // collaborators" (Manya, 6 Oct, on a YouTube Long-Form).
      if (missing.length) return NextResponse.json({ error: "Can't approve yet — some required fields are missing.", missing, gate: "approve" }, { status: 422 });
    }

    // B) Output-Ready: there must be a deliverable — a creative file OR an output link.
    if (newStatus === "Output - Ready" && wasStatus !== "Output - Ready") {
      const { count: creativeCount } = await sb.from("mh_attachments").select("id", { count: "exact", head: true }).eq("post_id", body.id).eq("kind", "creative");
      if (!filled(eff("output_link")) && !(creativeCount || 0)) {
        return NextResponse.json({ error: "No creative uploaded — add a creative file or an output link first.", missing: ["A creative file or an output link"], gate: "output" }, { status: 422 });
      }
    }

    // C) Ready-to-Publish: the last stop before the Scheduler picks it up, so
    // everything the publish step needs must already exist — the creative itself,
    // the copy that goes out with it, and the date it's going out on. Without this
    // the Scheduler's own client-side guard was the only check, and Content Review
    // could push an empty shell straight into the queue.
    if (newStatus === "Ready to Publish" && wasStatus !== "Ready to Publish") {
      const missing: string[] = [];
      // Stricter since 27 Oct (Praveen): the brief no longer counts as the caption, a
      // Drive/Canva link can't be posted to Instagram/Facebook, a carousel needs real
      // slides, and the LinkedIn PDF is not a slide.
      const isPdfName = (n: string) => /\.pdf(\?|#|$)/i.test(n.split("?")[0]);
      const { data: creRows } = await sb.from("mh_attachments").select("filename").eq("post_id", body.id).eq("kind", "creative");
      const mediaUrls = (Array.isArray(preRow.media_urls) ? (preRow.media_urls as string[]) : []).filter(Boolean);
      const slideCount = Math.max((creRows || []).filter((r) => !isPdfName(String(r.filename || ""))).length, mediaUrls.filter((u) => !isPdfName(u)).length);
      const pdfCount = (creRows || []).filter((r) => isPdfName(String(r.filename || ""))).length + mediaUrls.filter(isPdfName).length;
      const platforms = (Array.isArray(eff("platforms")) ? (eff("platforms") as string[]) : []).map(String);
      // Unset platforms = the usual Instagram/Facebook post.
      const toMeta = !platforms.length || platforms.some((x) => /instagram|facebook/i.test(x));
      const type = String(eff("type") || "");
      if (toMeta && !slideCount) missing.push("The creative uploaded as a file — a Drive or Canva link can't be posted to Instagram or Facebook");
      else if (!toMeta && !slideCount && !pdfCount && !filled(eff("output_link"))) missing.push("A creative file or an output link");
      if (toMeta && type === "Carousel" && slideCount === 1) missing.push("At least 2 slides for a carousel (the LinkedIn PDF doesn't count as a slide)");
      // Stories go out with no caption (Praveen, 3 Nov 2026) — every primary interest.
      if (!/story/i.test(type) && !filled(eff("caption"))) missing.push("A caption — the text that goes out with the post (the brief doesn't count)");
      if (!filled(eff("publishing_date"))) missing.push("Publishing date");
      if (missing.length) return NextResponse.json({ error: "Not ready to publish yet — some required fields are missing.", missing, gate: "publish" }, { status: 422 });
    }

    // ── Publish-date approval gate ──────────────────────────────────────────
    // A non-approver moving ONLY the publish date needs Maheen's sign-off. Hold the
    // date (and its mirrored due_date) out of this write and raise a request; any
    // other field in the same patch still saves.
    const gateActor = ((typeof (body as { actor?: string }).actor === "string" ? (body as { actor?: string }).actor! : getSessionUserId()) || "").toLowerCase();
    let pendingApproval: { from: string | null; to: string | null } | null = null;
    // Who must wait is set per person in Team & access ("Date changes need admin
    // approval"); unset means everyone except Maheen, as it always was. Decided by the
    // signed-in person, not the `actor` a page sends.
    if ("publishing_date" in clean && !firstDate && needsDateApproval(await rosterById(me || gateActor))) {
      const oldDate = (preRow.publishing_date as string | null) ?? null;
      const newDate = (clean.publishing_date as string | null) ?? null;
      const day = (d: string | null) => (d ? String(d).slice(0, 10) : null);
      if (day(oldDate) !== day(newDate)) {
        const reason = typeof (body as { reason?: string }).reason === "string" ? (body as { reason?: string }).reason : undefined;
        await requestDateChange(sb, {
          postId: body.id,
          title: String(preRow.particulars || "a task"),
          type: (preRow.type as string) || undefined,
          owner: (preRow.owner_key as string) || undefined,
          createdAt: (preRow.created_at as string) || undefined,
          from: oldDate, to: newDate, reason,
          requestedBy: gateActor || (preRow.owner_key as string) || "someone",
        });
        pendingApproval = { from: oldDate, to: newDate };
        delete clean.publishing_date;
        delete clean.due_date;
      }
    }
    // Applied straight away → any older request for this post is out of date.
    if ("publishing_date" in clean && !pendingApproval) await supersedeDateChange(sb, body.id, me || gateActor || "someone");
    // Date-only change with nothing else to save → stop here; the date is pending.
    if (pendingApproval && Object.keys(clean).length === 0) {
      return NextResponse.json({ id: body.id, pendingApproval, message: "Publish-date change sent to Maheen for approval." });
    }

    const { data, error } = await sb
      .from("mh_posts")
      .update(clean)
      .eq("id", body.id)
      .select("id, particulars, status, type, owner_key, updated_at, custom")
      .single();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "row not found" }, { status: 404 });

    // Clear the marketing-hub read cache so this edit reflects on the next fetch
    // (drag-reschedule / inline edits would otherwise snap back until the 12h TTL).
    bustMarketingHubCache();

    // Actor = the client-supplied person (My Day passes the switched person) or the
    // logged-in session user. This is what makes the activity feed read "Praveen …".
    const bodyActor = typeof (body as { actor?: string }).actor === "string" ? (body as { actor?: string }).actor : null;
    const actor = bodyActor || getSessionUserId() || null;

    // Log every changed field with before/after + actor. Long text (content/caption)
    // stores the full old/new so the modal can render a word-level diff.
    const ACTION: Record<string, string> = {
      status: "status_changed", owner_key: "owner_changed", publishing_date: "rescheduled",
      due_date: "due_date_changed", particulars: "renamed", priority: "priority_changed",
      type: "type_changed", content: "content_edited", caption: "caption_edited",
      additional_info: "notes_edited", sbu: "sbu_changed", platforms: "platforms_changed",
      needs_review: "review_changed", output_link: "output_link_changed",
      instagram_url: "instagram_url_changed", facebook_url: "facebook_url_changed", linkedin_url: "linkedin_url_changed",
      reference_links: "reference_links_changed",
    };
    const fmtDate = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "unset");
    const asText = (field: string, v: unknown): string | null => {
      if (v === null || v === undefined || v === "") return null;
      if (field === "publishing_date" || field === "due_date") return fmtDate(v);
      if (Array.isArray(v)) return v.length ? v.join(", ") : null;
      return String(v);
    };
    const beforeRow = before.data as Record<string, unknown>;
    // What was actually saved: the database's ownership rule (mh_design_owner) can
    // override owner/status. Log and report THAT, not what was asked for — the history
    // said "owner changed to Nandu" on a design task that had stayed with Praveen.
    const saved = data as Record<string, unknown>;
    const actual = (field: string) => (field in saved ? saved[field] : clean[field]);
    let ownershipNote: string | null = null;
    if ("owner_key" in clean && (saved.owner_key ?? null) !== (clean.owner_key ?? null)) {
      // Name whoever it was actually kept with — the Rules page decides that now, not a fixed person.
      const editorPicked = isEditor(String(clean.owner_key || ""));
      const keptWith = String(saved.owner_key || "");
      const kept = keptWith ? keptWith.charAt(0).toUpperCase() + keptWith.slice(1) : "the current owner";
      ownershipNote = editorPicked
        ? `Kept with ${kept} while it's design work. ${String(clean.owner_key).charAt(0).toUpperCase() + String(clean.owner_key).slice(1)} gets it as soon as the format is changed to a video type (e.g. Meta Ads - Video).`
        : `The rules keep this task with ${kept} at this stage — change the format or the rule on the Rules page to give it to someone else.`;
    } else if ("type" in clean && isDesigner(String(beforeRow.owner_key || "")) && saved.owner_key == null && saved.status === "Content - Approved") {
      ownershipNote = "It's a video task now, so it went to the editors' claim pool for Nikhil / Nandu to pick up.";
    } else if ("type" in clean && isDesigner(String(beforeRow.owner_key || "")) && typeof saved.owner_key === "string" && !isDesigner(saved.owner_key)) {
      ownershipNote = `It's a video task now, so it went to ${saved.owner_key.charAt(0).toUpperCase() + saved.owner_key.slice(1)} (picked as owner earlier).`;
    }
    const extraFields = ["owner_key", "status"].filter((f) => !(f in clean) && f in saved && (saved[f] ?? null) !== (beforeRow[f] ?? null));
    const activityRows = [...Object.keys(clean).filter((field) => field !== "custom"), ...extraFields].flatMap((field) => {
      const oldV = beforeRow[field];
      const newV = actual(field);
      const same = Array.isArray(oldV) || Array.isArray(newV)
        ? JSON.stringify(oldV ?? []) === JSON.stringify(newV ?? [])
        : (oldV ?? null) === (newV ?? null);
      if (same) return [];
      // The reason asked for on every date move (22 Oct) rides on the rescheduled
      // entry, so the task's history says why.
      const why = field === "publishing_date" && typeof (body as { reason?: string }).reason === "string" ? (body as { reason?: string }).reason!.trim() : "";
      return [{
        post_id: body.id,
        actor_key: actor,
        action: ACTION[field] || "edited",
        from_value: asText(field, oldV),
        to_value: asText(field, newV),
        ...(why ? { detail: why } : {}),
      }];
    });
    if (activityRows.length) await sb.from("mh_activity").insert(activityRows);

    // Approved again after a creative change (lib/re-review.ts) — the "Changed after
    // approval" flag has done its job.
    if (clean.status === "Ready to Publish") {
      const cur = ((clean.custom ?? (before.data as { custom?: Record<string, unknown> }).custom) || {}) as Record<string, unknown>;
      if (cur.changed_after_approval) {
        const rest = { ...cur }; delete rest.changed_after_approval;
        await sb.from("mh_posts").update({ custom: rest }).eq("id", body.id);
      }
    }

    // Capture the END of the task clock the first time it reaches a done state,
    // so "Time taken" = start_at → end_at reflects how long the task took.
    const DONE_STATES = new Set(["Output - Ready", "Ready to Publish", "Published/Scheduled"]);
    // Re-stamped whenever it comes back into a done state from a working one — a task
    // sent back for feedback and finished again today was keeping its first finish time.
    if (typeof clean.status === "string" && DONE_STATES.has(clean.status) && (!before.data.end_at || !DONE_STATES.has(before.data.status))) {
      await sb.from("mh_posts").update({ end_at: new Date().toISOString() }).eq("id", body.id);
    }
    // START the task clock when it moves to "Output - In Progress" — this stamp is what
    // the live My Day timer counts from (planned vs on-the-clock).
    //
    // It used to stamp only when start_at was EMPTY, which quietly killed the timer for
    // any task carrying an older stamp — imported rows (whose start_at and end_at are
    // the same instant) and anything picked back up on a later day. My Day only ticks a
    // task started today, so those sat at "In Progress" with a dead clock.
    // A task entering In Progress is a working session starting NOW, so a stamp from
    // another day is replaced, and the stale end_at that went with it is cleared —
    // otherwise "Time taken" would read from an end that happened before this start.
    if (clean.status === "Output - In Progress" && before.data.status !== "Output - In Progress") {
      const now = new Date();
      const prev = before.data.start_at ? new Date(before.data.start_at) : null;
      const staleStart = !prev || Number.isNaN(prev.getTime())
        || prev.getFullYear() !== now.getFullYear() || prev.getMonth() !== now.getMonth() || prev.getDate() !== now.getDate();
      if (staleStart) {
        await sb.from("mh_posts").update({ start_at: now.toISOString(), end_at: null }).eq("id", body.id);
      }
    }
    // CANCEL a start. Going from In Progress back to a content stage means the work
    // never actually began — most often the task was opened by accident, which starts
    // it. Wipe the clock so the task doesn't keep a start time for work nobody did,
    // and so "Time taken" can't later be measured from it.
    const PRE_WORK = new Set(["Content - Pending", "Content - In Progress", "Content - Approved"]);
    if (typeof clean.status === "string" && PRE_WORK.has(clean.status) && before.data.status === "Output - In Progress") {
      await sb.from("mh_posts").update({ start_at: null, end_at: null }).eq("id", body.id);
    }

    // Auto-handoff when status becomes "Content - Approved" (assignment + collaborator
    // only — the status_changed / owner_changed rows above already record it, and the
    // notifications feed derives the handoff from status_changed -> Content-Approved):
    //   • Design/static work → auto-assigned to Praveen; the writer joins as collaborator.
    //   • Video work → left with the writer, claimable by an editor (Nikhil/Nandu).
    //   • Maheen is NEVER auto-added.
    // Mirror the key pipeline moments into the team chat (kind='system') so the
    // handoff also lands as a message, not just a bell notification.
    const chatActor = actor || before.data.owner_key || "maheen";
    const title = String(data.particulars || "a task");

    // TIME EXTENDED — the team hears it, and it lands in everyone else's notifications
    // (the feed is built from mh_activity, so the row below is what makes that happen).
    if (newExtension) {
      const delta = Number(newExtension.toMin) - Number(newExtension.fromMin);
      const mins = Math.abs(delta);
      const asText = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
      const who = MH_NAME[chatActor] || chatActor;
      try {
        await sb.from("mh_activity").insert({
          post_id: body.id, actor_key: chatActor, action: "time_extended",
          from_value: String(newExtension.fromMin), to_value: String(newExtension.toMin),
          detail: { reason: newExtension.reason, minutes: delta, undo: !!newExtension.undoOf },
        });
      } catch { /* courtesy trail */ }
      await postTeamMessage(sb, chatActor, newExtension.undoOf
        ? `↩️ ${who} took back ${asText} on “${title}” — ${newExtension.reason}`
        : `⏱️ Task extended — “${title}” +${asText}. ${who}: ${newExtension.reason}`);
    }
    if (typeof clean.status === "string" && clean.status !== before.data.status) {
      // Announce an approval only when the task is actually BEING approved — moving
      // forward out of the content stages. A task stepping back from production (an
      // accidental start being put back) lands on the same status without anyone
      // approving anything, and announcing it produced the nonsense line
      // "Praveen approved X — design work, handed to Praveen".
      if (clean.status === "Content - Approved" && APPROVAL_COMES_FROM.has(String(before.data.status))) {
        const isVideo = VIDEO_TYPES.has(String(data.type || ""));
        const who = MH_NAME[chatActor] || chatActor;
        // And don't tell someone they were handed their own work.
        const designer = firstWithRole("designer") || "praveen";
        const handedTo = chatActor === designer ? "design work, it's yours." : `design work, handed to ${MH_NAME[designer] || designer}.`;
        await postTeamMessage(sb, chatActor, isVideo
          ? `${who} approved “${title}” — video work, up for grabs in the editors' pool.`
          : (body as { deferHandoff?: boolean }).deferHandoff
          ? `${who} approved “${title}” — Praveen's day is full, so it's WAITING in his pipeline until he accepts.`
          : `${who} approved “${title}” — ${handedTo}`);
      } else if (clean.status === "Ready to Publish") {
        await postTeamMessage(sb, chatActor, `“${title}” is ready to publish.`);
      } else if (clean.status === "Incorporating Feedback") {
        await postTeamMessage(sb, chatActor, `${MH_NAME[chatActor] || chatActor} sent “${title}” back with feedback.`);
      }
      // Slack (#marketing-os-updates) — only the approval steps, so the channel
      // stays worth reading.
      const who = MH_NAME[chatActor] || chatActor;
      const link = `<${slackTaskLink(body.id)}|${title}>`;
      const slackLine =
        clean.status === "Content - Needs Approval" ? `🟡 *Needs approval* — ${link} (sent by ${who})`
        : clean.status === "Content - Approved" && APPROVAL_COMES_FROM.has(String(before.data.status)) ? `✅ *Approved* — ${link} by ${who}`
        : clean.status === "Output - Ready" ? `🟡 *Output ready for review* — ${link} (from ${who})`
        : clean.status === "Incorporating Feedback" ? `↩️ *Sent back with feedback* — ${link} by ${who}`
        : "";
      if (slackLine) await postSlack(slackLine);
    }

    // PIPELINE HOLD: when the assigner saw "day already full" and chose to queue it,
    // we do NOT auto-assign — the task stays with the writer, the producer gets the
    // notification/chat ping, and ownership only moves when THEY accept (takeover).
    const deferHandoff = (body as { deferHandoff?: boolean }).deferHandoff === true;
    // A thumbnail created by the thumbnail flow is the one kind of design work that is
    // NOT automatically Praveen's: someone was asked who should make it and answered,
    // and these days the editor cutting the reel usually makes its thumbnail too.
    // Handing it over here would silently overrule that answer.
    //
    // This is the THIRD place that had to learn the exception — sql/020 and sql/021
    // cover the two database triggers. Anything that reassigns on approval needs it,
    // and this one is the application's own handoff, so a migration could never have
    // fixed it. docs/THUMBNAIL_FLOW_SPEC.md.
    const beforeCustom = (before.data as { custom?: Record<string, unknown> }).custom;
    const isOwnedThumbnail = !!(beforeCustom && typeof beforeCustom.thumbnail_for === "string" && beforeCustom.thumbnail_for);
    // With the rules engine on (sql/037), the Rules page decides this in the database —
    // this hard-coded hand-off stands down so it can't overrule a rule.
    if (clean.status === "Content - Approved" && before.data.status !== "Content - Approved" && !deferHandoff && !isOwnedThumbnail && !(await rulesEngineOn())) {
      const isVideo = VIDEO_TYPES.has(String(data.type || ""));
      const oldOwner = before.data.owner_key;
      // A video an editor filed (so it started on them as its creator) goes to the
      // claim pool when its content is approved, like every other video — it used to
      // stay theirs, and the pool hides videos an editor owns (Nandu, 22 Oct). Only
      // from the content stages: a task coming back from production keeps its editor.
      const fromContent = ["Content - Pending", "Content - In Progress"].includes(String(before.data.status));
      // Only when that editor CREATED it — a video someone handed to Nandu on purpose stays his.
      const createdBy = String((before.data as { created_by?: string | null }).created_by || "").toLowerCase();
      if (isVideo && fromContent && isEditor(String(oldOwner || "")) && createdBy === String(oldOwner).toLowerCase() && data.owner_key === oldOwner) {
        await sb.from("mh_posts").update({ owner_key: null }).eq("id", body.id);
        await sb.from("mh_activity").insert({ post_id: body.id, actor_key: actor, action: "owner_changed", from_value: oldOwner, to_value: null });
      }
      if (!isVideo) {
        // Add the writer as collaborator FIRST, THEN flip the owner — so a My Day poll
        // landing mid-handoff never sees owner=praveen with no collaborator yet (which
        // made the task blink off Manya's board). Now every snapshot is consistent:
        // she sees it as owner (before) or as collaborator (after).
        const designerKey = firstWithRole("designer") || "praveen";
        if (oldOwner && !isDesigner(oldOwner) && roleOf(oldOwner) !== "manager") {
          await sb.from("mh_post_collaborators").upsert(
            [{ post_id: body.id, member_key: oldOwner }],
            { onConflict: "post_id,member_key", ignoreDuplicates: true },
          );
        }
        if (data.owner_key !== designerKey) {
          await sb.from("mh_posts").update({ owner_key: designerKey }).eq("id", body.id);
          await sb.from("mh_activity").insert({ post_id: body.id, actor_key: actor, action: "owner_changed", from_value: oldOwner, to_value: designerKey });
        }
      }
    }

    // Saying you are on camera puts you ON the task, not just in a field.
    //
    // The presenter was recorded only as custom.presenter_key, which no board
    // reads. My Day lists a task for its owner OR its collaborators, so a
    // presenter who was neither saw the task nowhere — he had said he was
    // presenting and it still showed up for no one but the editor. The presenter
    // now joins the collaborators: the editor keeps the task (they do the
    // cutting) and it appears for both of them, next to the writer. So a reel
    // Nandu is cutting that Nikhil fronted reads owner Nandu, collaborators
    // Nikhil and Manya.
    //
    // Same shape the claim path already produces in /takeover, so a presenter
    // named before the claim and one named afterwards end up in the same place.
    // The two editors pair up by themselves.
    //
    // "When I select on camera the automation should automate editing to Nandu, and
    // if he selects edit option it should automate me as on camera" (Nikhil, 5 Oct).
    // A video needs one person in front of the camera and one behind it, and with
    // two editors naming one always implies the other — so saying it twice was just
    // data entry.
    //
    // It only ever fills a BLANK. Going on camera claims the editing for the other
    // editor only while the task is still unowned, and claiming the editing names
    // the other editor as presenter only while nobody is on camera. So it can never
    // take a task off whoever already has it, and either half can be overridden
    // afterwards from the task itself.
    //
    // siblingOf returns null for anyone who is not an editor, which is what keeps
    // this from firing when Manya or Praveen touches a video.
    const isVideo = VIDEO_TYPES.has(String(data.type || ""));
    if (isVideo && customPatch) {
      const ownerNow = ((data.owner_key as string | null) || "").toLowerCase();
      const presenterNow = typeof (clean.custom as Record<string, unknown>)?.presenter_key === "string"
        ? ((clean.custom as Record<string, string>).presenter_key || "").toLowerCase() : "";

      // Going on camera → the other editor gets the editing, if it is going spare.
      const newPresenter = typeof customPatch.presenter_key === "string" ? customPatch.presenter_key.toLowerCase() : "";
      // "Going spare" means in the claim pool — the same test as app/api/my-day: an
      // approved video no editor owns. Pool videos usually still belong to the WRITER,
      // so checking for an empty owner alone meant this never fired from the pool and
      // nobody's workload moved (Nikhil, 9 Oct).
      const inPool = !ownerNow || ownerNow === "unclaimed"
        || (String(data.status) === "Content - Approved" && !siblingOf(ownerNow));
      if (newPresenter && inPool) {
        const editor = siblingOf(newPresenter);
        if (editor) {
          await sb.from("mh_posts").update({ owner_key: editor }).eq("id", body.id);
          await sb.from("mh_activity").insert({ post_id: body.id, actor_key: actor, action: "owner_changed", from_value: data.owner_key || null, to_value: editor });
          // The writer who handed it over keeps following it, as on a claim (/takeover).
          if (ownerNow && ownerNow !== "unclaimed") {
            await sb.from("mh_post_collaborators").upsert(
              [{ post_id: body.id, member_key: ownerNow }],
              { onConflict: "post_id,member_key", ignoreDuplicates: true },
            );
          }
        }
      }

      // Claiming the editing → the other editor is on camera, if nobody is yet.
      // "Both" is excluded on purpose: it means one person does the whole thing.
      const newRole = typeof customPatch.claim_role === "string" ? customPatch.claim_role.toLowerCase() : "";
      if (newRole === "edit" && !presenterNow && actor) {
        const presenter = siblingOf(actor.toLowerCase());
        if (presenter) {
          const merged = { ...((clean.custom as Record<string, unknown>) || {}), presenter_key: presenter };
          await sb.from("mh_posts").update({ custom: merged }).eq("id", body.id);
          await sb.from("mh_post_collaborators").upsert(
            [{ post_id: body.id, member_key: presenter }],
            { onConflict: "post_id,member_key", ignoreDuplicates: true },
          );
        }
      }
    }

    if (customPatch && Object.prototype.hasOwnProperty.call(customPatch, "presenter_key")) {
      const prevPresenter = typeof beforeCustom?.presenter_key === "string" ? beforeCustom.presenter_key : "";
      const nextPresenter = typeof customPatch.presenter_key === "string" ? customPatch.presenter_key : "";
      const ownerKey = (data.owner_key as string | null) || "";
      // Nobody is ever both owner and collaborator — an editor who shot it
      // themselves is already on the task as its owner.
      if (nextPresenter && nextPresenter !== ownerKey) {
        await sb.from("mh_post_collaborators").upsert(
          [{ post_id: body.id, member_key: nextPresenter }],
          { onConflict: "post_id,member_key", ignoreDuplicates: true },
        );
      }
      // Standing down takes you back off the task — unless you belong on it for
      // another reason, i.e. you are its default collaborator (the writer, or
      // Nandu on 12thPlus / GC India). Dropping those would quietly undo the
      // handoff.
      if (prevPresenter && prevPresenter !== nextPresenter && prevPresenter !== ownerKey) {
        const def = await defaultCollaboratorFor((before.data as { sbu?: string | null }).sbu ?? null, ownerKey, data.type as string | null);
        if (prevPresenter !== def) {
          await sb.from("mh_post_collaborators").delete().eq("post_id", body.id).eq("member_key", prevPresenter);
        }
      }
    }

    return NextResponse.json({ id: data.id, fields: data, updatedAt: data.updated_at, pendingApproval, ...(ownershipNote ? { warning: ownershipNote } : {}) });
  } catch (err) {
    return NextResponse.json(safeError(err, "Task update failed"), { status: 502 });
  }
}
