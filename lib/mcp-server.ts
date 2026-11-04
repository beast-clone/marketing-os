import { NextResponse } from "next/server";
import { userForKey } from "@/lib/claude-connector";
import { connectorForKey, type Scope } from "@/lib/connectors";
import { connectionForAccessToken, issuer } from "@/lib/oauth";
import { rosterById, fetchRoster, activeTeamIds } from "@/lib/team-db";
import { SBU_OPTIONS } from "@/lib/sbus";
import { fetchSbus } from "@/lib/sbus-db";
import { CONTENT_TYPES, ALL_TYPES } from "@/lib/mh-content-types";
import { canClaude } from "@/lib/permissions";
import { createTask, normalizeOwner } from "@/lib/task-create";
import { listTasks, getTask, searchTasks, updateTask, whatsDue, listRadar, schedulePost, deleteTasks, listRecycleBin, restoreTasks, listQueue, unscheduleTool, rescheduleTool, retryTool, setCollaborators, addComment, attachFromLink } from "@/lib/mcp-tools";
import { fetchContentTypes } from "@/lib/content-types-db";

// The Claude connector, protocol and all.
//
// Lives here rather than in the route because it is served from two URLs that must
// behave identically:
//   /api/mcp            — key in the Authorization header. Claude Code (terminal).
//   /api/mcp/<key>      — key in the URL. Claude Desktop and claude.ai, whose
//                         "add a custom connector" box takes a URL and nothing else.
// One implementation, so the two can never drift into different tool sets.

export type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
export const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
export const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

// Every reply Claude gets is a content block. Errors are isError blocks rather than
// protocol errors on purpose: a protocol error makes Claude give up, where an isError
// block is something it can read and act on — usually by asking the user a question.
const say = (id: Rpc["id"], t: string, isError = false) => ok(id, { content: [{ type: "text", text: t }], isError });
const json = (id: Rpc["id"], v: unknown) => say(id, JSON.stringify(v, null, 1));

/** The people a task can be assigned to. One list, because it appears in several
 *  tool schemas and they must not drift apart. */
// Fallback only: tools/list replaces these enums with the live Team page roster (liveTools).
const TEAM = ["manya", "praveen", "nikhil", "nandu", "maheen"] as const;

const TOOLS = [
  {
    name: "create_task",
    title: "Create a task in GooCampus Marketing OS",
    description:
      "Create ONE content task in the GooCampus Marketing OS dashboard (lands in the Master sheet as \"Content - Pending\", created by the connected person). " +
      "primary_interest, content_type and owner are REQUIRED: if the user hasn't clearly said them, ASK the user — never guess or pick a default. " +
      "In particular do NOT assume the person talking to you is the owner — here, work is usually created by one person for someone else to do. " +
      "Put the post body / script / slide text in `content` and the social caption in `caption` — they are DIFFERENT fields; never merge them or copy one into the other. " +
      "If the user gave you content but no caption, ASK whether they want one before calling: offer to write it, or to leave it empty for the writer. " +
      "Do not invent a caption silently, and do not block on it — if they say skip, leave it empty and create the task. " +
      "Formats that carry no caption of their own (Story (Image), Story (Video), Reel Thumbnail, YouTube Thumbnail, Meta Ads) don't need the question — leave caption empty for those. " +
      "Ask everything you are missing in ONE message rather than one question at a time. " +
      "Confirm the title, primary interest, content type and publishing date with the user before calling if anything is ambiguous.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task name, e.g. \"AMC batch - carousel\"." },
        primary_interest: { type: "string", enum: [...SBU_OPTIONS], description: "Which brand / SBU the task is for. Ask the user if not given." },
        content_type: { type: "string", enum: [...CONTENT_TYPES], description: "Format of the content. Ask the user (carousel, reel, YouTube…) if not given." },
        content: { type: "string", description: "The finalised content: post copy, carousel slide text or video script." },
        caption: { type: "string", description: "The caption that gets published with the post — separate from `content`, which is the script/slide text. Ask the user for it if they gave content but no caption; leave empty if they decline or the format has no caption." },
        publishing_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Planned publishing date, YYYY-MM-DD." },
        priority: { type: "string", enum: ["Low", "Medium", "High"], description: "Defaults to Medium." },
        owner: { type: "string", enum: [...TEAM], description: "Who does the work next. REQUIRED — ask the user, don't assume it's them. Creating a task and owning it are usually different people here." },
        platforms: { type: "array", items: { type: "string", enum: ["Instagram", "Facebook", "YouTube", "LinkedIn"] }, description: "Defaults to Instagram, Facebook, LinkedIn." },
      },
      required: ["title", "primary_interest", "content_type", "owner"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    title: "List tasks on the board",
    description: "List content tasks, newest publishing date first. Filter by owner, status, brand, type or a publishing-date range. Use this to answer questions like \"what is Manya working on\" before assuming anything.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", enum: [...TEAM] },
        status: { type: "string", description: "e.g. \"Content - Pending\", \"Content - Approved\", \"Ready to Publish\"." },
        brand: { type: "string", enum: [...SBU_OPTIONS] },
        type: { type: "string", enum: [...CONTENT_TYPES] },
        from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Publishing date from (inclusive)." },
        to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Publishing date to (inclusive)." },
        limit: { type: "number", description: "1-50, default 20." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    title: "Read one task in full",
    description: "Read a single task by id, with the full caption and content rather than the trimmed preview list_tasks returns.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The task id." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "search_tasks",
    title: "Search tasks by words",
    description: "Find tasks whose title, caption or content contain the given words. Use this when the user refers to a task by what it is about rather than by id.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number", description: "1-50, default 20." } },
      required: ["query"], additionalProperties: false,
    },
  },
  {
    name: "update_task",
    title: "Change a task",
    description:
      "Change an existing task. You may set status, publishing_date, due_date, priority, owner, caption, content or type. " +
      "You may NOT change which brand it belongs to, and there is no way to delete a task — both are deliberate. " +
      "Read the task first if you are not certain which one the user means, and say what you changed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        publishing_date: { type: "string", description: "YYYY-MM-DD, or empty string to clear." },
        due_date: { type: "string", description: "YYYY-MM-DD, or empty string to clear." },
        reason: { type: "string", description: "Why the publishing date is moving. Required for people whose 'Ask why when a date moves' is on — ask the user for it." },
        priority: { type: "string", enum: ["Low", "Medium", "High"] },
        owner: { type: "string", enum: [...TEAM] },
        caption: { type: "string" },
        content: { type: "string" },
        type: { type: "string", enum: [...CONTENT_TYPES] },
      },
      required: ["id"], additionalProperties: false,
    },
  },
  {
    name: "schedule_post",
    title: "Schedule or publish a post",
    description:
      "Put a finished post into the Scheduler for a date and time, or publish it now, to Instagram/Facebook. " +
      "Only works for people with 'Publish from Claude' switched on, only to their own Scheduler pages, and only for a task that has cleared review (status Ready to Publish) or is already queued. " +
      "Publishing is public and can't be undone: before calling, tell the user exactly which post, which page(s) and when, and get a clear yes. Never call it on your own initiative. " +
      "when: \"now\" or a date and time in India time like \"2026-11-05 18:30\". The page comes from the post's Primary Interest unless the user names pages. Format is worked out from the task (story, reel or post) unless given.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The task id." },
        when: { type: "string", description: "\"now\", or \"YYYY-MM-DD HH:mm\" in India time." },
        pages: { type: "array", items: { type: "string" }, description: "Optional. Page names to post to, e.g. \"Samvaya Matrimony\". Default: the post's own page." },
        format: { type: "string", enum: ["post", "reel", "story"], description: "Optional. Default: worked out from the task." },
        also_story: { type: "boolean", description: "Optional. Also share a single image/reel as a Story at the same time." },
      },
      required: ["id", "when"], additionalProperties: false,
    },
  },
  {
    name: "delete_tasks",
    title: "Delete tasks (to the recycle bin)",
    description:
      "Move one or more tasks to the recycle bin. A reason is REQUIRED — ask the user why before calling; without one nothing is deleted. " +
      "Nothing is erased: they can be restored with restore_tasks. Only for people with Connectors → Delete tasks switched on. " +
      "Name the task(s) back to the user and get a clear yes first, especially for several at once.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Task ids (1-50). Find them with search_tasks or list_tasks first." },
        reason: { type: "string", description: "Why they're being deleted — saved in the task's history." },
      },
      required: ["ids", "reason"], additionalProperties: false,
    },
  },
  {
    name: "list_recycle_bin",
    title: "See the recycle bin",
    description: "Recently deleted tasks: title, who deleted it, when and why. Use it to find ids for restore_tasks.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "1-50, default 20." } }, additionalProperties: false },
  },
  {
    name: "restore_tasks",
    title: "Restore tasks from the recycle bin",
    description: "Bring deleted tasks back, exactly as they were. Same permission as delete_tasks.",
    inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"], additionalProperties: false },
  },
  {
    name: "list_queue",
    title: "See the Scheduler queue",
    description: "Posts in the Scheduler by status — scheduled (default, soonest first), published (newest first), failed or draft — with page, format, time (India) and any failure reason.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["scheduled", "published", "failed", "draft"] },
        limit: { type: "number", description: "1-100, default 30." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unschedule_post",
    title: "Take a post out of the queue",
    description: "Remove a scheduled (or failed) post from the queue; it goes back to Ready to schedule, nothing is deleted. Its Story / extra story frames go with it. Needs Connectors → Schedule & publish and the page in their Scheduler pages. Confirm with the user first.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string", description: "Optional — saved in the history." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "reschedule_post",
    title: "Move a queued post to a new time",
    description: "Change when a scheduled (or failed) post goes out. when: \"YYYY-MM-DD HH:mm\" in India time. Story frames move with it. Same permission as schedule_post. Confirm the new time with the user first.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, when: { type: "string" } }, required: ["id", "when"], additionalProperties: false },
  },
  {
    name: "retry_post",
    title: "Retry a failed post",
    description: "Send a failed post again (like the Scheduler's Try again). Check failure in list_queue first — if the creative itself is the problem, fix it before retrying.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "set_collaborators",
    title: "Add or remove collaborators on a task",
    description: "Teammates working on a task alongside its owner. Needs Connectors → Edit tasks.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        add: { type: "array", items: { type: "string", enum: [...TEAM] } },
        remove: { type: "array", items: { type: "string", enum: [...TEAM] } },
      },
      required: ["id"], additionalProperties: false,
    },
  },
  {
    name: "attach_file",
    title: "Add a creative or file to a task from a link",
    description: "Downloads a file from a link and adds it to the task, like uploading it in the dashboard. Google Drive and Dropbox share links work if shared as 'Anyone with the link'; any other direct public link works too. kind: creative (default — the image/video that gets posted; jpg, png, gif, webp, mp4, mov, pdf), reference, or attachment. Up to 100 MB. Adding a creative sends an approved task back for review, as in the dashboard. Needs Connectors → Edit tasks.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id" },
        url: { type: "string", description: "Link to the file" },
        kind: { type: "string", enum: ["creative", "reference", "attachment"] },
        filename: { type: "string", description: "Optional name to save it under" },
      },
      required: ["id", "url"], additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    title: "Comment on a task",
    description: "Add a comment to a task's thread, under the user's own name.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false },
  },
  {
    name: "whats_due",
    title: "What is due, and what is overdue",
    description: "Tasks with a publishing date on or before N days from today (IST), split into overdue and due. Anything already published or ready to publish is left out.",
    inputSchema: { type: "object", properties: { days: { type: "number", description: "0 = today only, 1 = through tomorrow. Default 1, max 30." } }, additionalProperties: false },
  },
  {
    name: "list_radar",
    title: "What Content Radar is showing",
    description: "The news Content Radar has picked up in the last 30 days — headline, source, topic and link. Read-only: to act on one, write the copy and then call create_task, so the dashboard's own rules and activity trail still apply.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "1-50, default 15." } }, additionalProperties: false },
  },
];

/** TOOLS with the brand lists filled from mh_sbus (sql/027) and owners from the
 *  Team page roster, so a brand added in the
 *  dashboard is offered to Claude without a deploy. SBU_OPTIONS above is only the
 *  fallback baked into the static copy. */
// What each tool needs when the caller is a connector (lib/connectors). People are
// checked by their own permissions instead; scopes is undefined for them.
const TOOL_SCOPE: Record<string, Scope> = {
  list_tasks: "read", get_task: "read", search_tasks: "read", whats_due: "read", list_queue: "read",
  create_task: "create", update_task: "update", list_radar: "radar",
};
const DATE_FIELDS = ["publishing_date", "due_date"];

async function liveTools(scopes?: Scope[]) {
  const [sbus, team, types] = await Promise.all([
    fetchSbus(), activeTeamIds().then((t) => [...t]), fetchContentTypes().then((t) => t.map((x) => x.name)),
  ]);
  return TOOLS.filter((t) => !scopes || scopes.includes(TOOL_SCOPE[t.name])).map((t) => {
    const props = { ...(t.inputSchema.properties as unknown as Record<string, Record<string, unknown>>) };
    for (const k of ["primary_interest", "brand"]) if (props[k]) props[k] = { ...props[k], enum: sbus };
    if (props.owner) props.owner = { ...props.owner, enum: team };
    for (const k of ["content_type", "type"]) if (props[k]) props[k] = { ...props[k], enum: types };
    return { ...t, inputSchema: { ...t.inputSchema, properties: props } };
  });
}

async function createOne(id: Rpc["id"], userId: string, args: Record<string, unknown>, origin: string, via?: string, scopes?: Scope[]) {
  const me = await rosterById(userId);
  if (!scopes && !canClaude(me, "create")) {
    return say(id, "Creating tasks from Claude isn't switched on for you. Ask an admin (Team & access → Connectors → Create tasks).", true);
  }
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
  const title = s("title"), sbu = s("primary_interest"), type = s("content_type"), date = s("publishing_date");
  const owner = s("owner");

  // These come back as questions for Claude to put to the user, not as failures —
  // "which brand is this for?" is the single most common thing people forget to say.
  //
  // owner is in this list as of 27 Sep 2026. It used to fall back to whoever was
  // connected, which quietly assumed the person creating a task is the person doing
  // the work — usually wrong here, since Praveen and Maheen mostly create work for
  // Manya, Nikhil and Nandu. A wrong owner is worse than no owner: it lands in
  // somebody's workload and neither of them finds out.
  const missing = [!title && "title", !sbu && "primary_interest", !type && "content_type", !owner && "owner"].filter(Boolean);
  if (missing.length) return say(id, `Missing required field(s): ${missing.join(", ")}. Ask the user for them, then call create_task again.`, true);
  const sbus = await fetchSbus();
  if (!sbus.includes(sbu)) return say(id, `"${sbu}" isn't a primary interest in the dashboard. Valid options: ${sbus.join(", ")}. Ask the user which one.`, true);
  if (!ALL_TYPES.includes(type)) return say(id, `"${type}" isn't a content type. Valid: ${ALL_TYPES.join(", ")}. Ask the user which one.`, true);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return say(id, "publishing_date must be YYYY-MM-DD.", true);
  const ownerKey = normalizeOwner(owner);
  if (!ownerKey) return say(id, `"${owner}" isn't someone on the team. Ask the user who should own this — one of: ${[...(await activeTeamIds())].join(", ")}.`, true);

  const task = await createTask({
    title, sbu, type,
    content: s("content") || undefined, caption: s("caption") || undefined,
    publishingDate: date || undefined, priority: s("priority") || "Medium",
    owner: ownerKey,
    platforms: Array.isArray(args.platforms) ? (args.platforms as unknown[]).filter((p): p is string => typeof p === "string") : undefined,
  }, userId, "claude-connector", via);

  return say(id,
    `Created “${task.particulars}” (${type} · ${sbu}) — owner ${task.owner_key || "none"}, status ${task.status}${task.publishing_date ? `, publishing ${task.publishing_date}` : ""}.\n` +
    `Open it: ${origin}/dashboard/preview/marketing-hub?tab=master&open=${task.id}`);
}

async function callTool(id: Rpc["id"], userId: string, name: string, args: Record<string, unknown>, origin: string, via?: string, scopes?: Scope[]) {
  if (scopes) {
    if (!TOOL_SCOPE[name] || !scopes.includes(TOOL_SCOPE[name])) return say(id, `This connector isn't allowed to use ${name}. An admin can change what it may do on System → Connectors.`, true);
    if (name === "update_task" && DATE_FIELDS.some((f) => f in args) && !scopes.includes("dates")) return say(id, "This connector isn't allowed to change dates. An admin can allow it on System → Connectors.", true);
  }
  await fetchRoster();   // owner names below resolve against the Team page roster
  await fetchContentTypes();   // registers dashboard-added types into VIDEO_TYPES (sql/028)
  switch (name) {
    case "create_task":  return createOne(id, userId, args, origin, via, scopes);
    case "list_tasks":   return json(id, await listTasks(args, origin));
    case "get_task":     return json(id, await getTask(args, origin));
    case "search_tasks": return json(id, await searchTasks(args, origin));
    case "whats_due":    return json(id, await whatsDue(args, origin));
    case "list_radar":   return json(id, await listRadar(args));
    case "update_task": {
      const me = await rosterById(userId);
      if (!scopes && !canClaude(me, "edit")) {
        return say(id, "Editing tasks from Claude isn't switched on for you. Ask an admin (Team & access → Connectors → Edit tasks).", true);
      }
      const res = await updateTask(args, userId, origin, via);
      return say(id, `Changed ${res.updated.join(", ")} on “${res.task.title}”.\n${res.task.link}\n\n${JSON.stringify(res.task, null, 1)}`);
    }
    case "delete_tasks":     return json(id, await deleteTasks(args, userId, via));
    case "list_recycle_bin": return json(id, await listRecycleBin(args));
    case "restore_tasks":    return json(id, await restoreTasks(args, userId));
    case "list_queue":       return json(id, await listQueue(args));
    case "unschedule_post":  return say(id, await unscheduleTool(args, userId));
    case "reschedule_post":  return say(id, await rescheduleTool(args, userId));
    case "retry_post":       return say(id, await retryTool(args, userId));
    case "set_collaborators": return say(id, await setCollaborators(args, userId));
    case "add_comment":      return say(id, await addComment(args, userId));
    case "attach_file": {
      const me = await rosterById(userId);
      if (!scopes && !canClaude(me, "edit")) return say(id, "Editing tasks from Claude isn't switched on for you. Ask an admin (Team & access → Connectors → Edit tasks).", true);
      return say(id, await attachFromLink(args, userId));
    }
    case "schedule_post": {
      const res = await schedulePost(args, userId, via);
      return say(id, `${res.message}\n“${res.title}” · ${res.format}`);
    }
    default: return fail(id, -32602, `Unknown tool: ${name}`);
  }
}

export async function handleRpc(msg: Rpc, userId: string, origin: string, via?: string, scopes?: Scope[]) {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "goocampus-marketing-os", version: "2.0.0" },
        instructions:
          "Read and write the GooCampus Marketing OS content board. " +
          "Before creating a task you MUST know the primary interest (brand) and the content type — if the user has not said them, ask; never guess. " +
          "Prefer looking before acting: use search_tasks or list_tasks to find the task the user means rather than assuming an id. " +
          "You cannot delete anything, and you cannot move a task to a different Primary Interest.",
      });
    case "ping": return ok(msg.id, {});
    case "tools/list": return ok(msg.id, { tools: await liveTools(scopes) });
    case "tools/call": {
      const p = msg.params || {};
      try { return await callTool(msg.id, userId, String(p.name || ""), (p.arguments as Record<string, unknown>) || {}, origin, via, scopes); }
      catch (e) { return say(msg.id, `That didn't work: ${(e as Error).message}`, true); }
    }
    default: return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Claude Desktop and claude.ai call from a browser context, so the preflight has to
 *  pass or the connector never gets as far as sending a key. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Every header name a client might carry the key in. Claude Desktop's picker
  // refuses Authorization (reserved for OAuth) and offers these instead, so a
  // browser-based client would fail preflight without them listed here.
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, MCP-Protocol-Version, x-api-key, api-key, apikey, x-apikey, x-api-token, api-token, x-auth-token",
  // Without this a browser-based client cannot read the header that tells it where
  // to sign in — the response arrives but the useful part is hidden from the script.
  "Access-Control-Expose-Headers": "WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

/**
 * One request, whichever URL it arrived on.
 *
 * Lives here rather than in a route file because a Next route module may only export
 * route handlers — exporting a helper from one breaks the production type check, which
 * is exactly how this got caught.
 */
export async function serve(req: Request, key: string) {
  // Two ways in. A personal key (gck_…) is what Claude Code uses and what the
  // /api/mcp/<key> URL carries; an OAuth access token is what the desktop app and
  // claude.ai get after someone approves. Both arrive in the same place, so try the
  // cheap prefix check first and fall through.
  // A connector key (gcx_…) acts under the connector's own name, limited to what it
  // was allowed; a person's key or sign-in acts as that person.
  const connector = key.startsWith("gcx_") ? await connectorForKey(key) : null;
  const conn = connector
    ? { userId: connector.name, app: "" }
    : key.startsWith("gck_")
      ? await userForKey(key).then((u) => (u ? { userId: u, app: "personal key" } : null))
      : await connectionForAccessToken(key);
  const userId = conn?.userId ?? null;
  if (!userId) {
    // A bare 401 is what broke the first desktop setup: the client read it as "this
    // server wants OAuth", went looking for a sign-in service, found nothing and gave
    // up with "couldn't register". WWW-Authenticate points at the metadata that says
    // where to sign in, which is the trail the spec expects a client to follow.
    const iss = issuer(req.url);
    return NextResponse.json(
      fail(null, -32001, "Not signed in. Connect the GooCampus connector in Claude, or create a personal key on System → Connectors (needs the “Connect Claude” permission)."),
      {
        status: 401,
        headers: {
          ...CORS,
          "WWW-Authenticate": `Bearer realm="GooCampus Marketing OS", resource_metadata="${iss}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400, headers: CORS });

  const origin = new URL(req.url).origin;
  const msgs: Rpc[] = Array.isArray(body) ? body : [body];
  const replies = [];
  // Notifications carry no id and expect no reply.
  // "Nandu's Claude Code" — recorded on every change it makes, so a task's history
  // says whose connection did it, not just whose name.
  const who = connector ? null : await rosterById(userId);
  const via = connector ? `${connector.name} (connector)` : `${who?.first || who?.name || userId}'s ${conn!.app}`;
  for (const m of msgs) if (m && m.id !== undefined && m.id !== null) replies.push(await handleRpc(m, userId, origin, via, connector?.scopes));
  if (!replies.length) return new NextResponse(null, { status: 202, headers: CORS });
  return NextResponse.json(Array.isArray(body) ? replies : replies[0], { headers: CORS });
}
