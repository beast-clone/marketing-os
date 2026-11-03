import { NextResponse } from "next/server";
import { requireSection, requireCapability, requireSchedulerPages } from "@/lib/api-guard";
import { getAccount } from "@/lib/instagram";
import { loadPublishPages } from "@/lib/publish-pages-server";
import { getSupabase } from "@/lib/supabase";
import { safeError } from "@/lib/errors";
import { writeBackLink } from "@/lib/mh-linkback";

// POST /api/scheduler/publish  — app-direct Instagram publish (image).
// Body: { accountId, imageUrl, caption }  OR  { postId }  (pulls media/caption/
// account from the mh_posts row and marks it published on success).
//
// ⚠️ THIS PUBLISHES A REAL POST to the target Instagram account. Only call it
// deliberately. Video/Reels + scheduled posts are the n8n worker's job (not here).

const GRAPH = "https://graph.facebook.com/v25.0";

// The account behind a page value — the GooCampus pages or a linked brand
// (lib/publish-pages.ts). Unknown pages get no account: never a GooCampus default.
async function accountIdForPage(page: string): Promise<string | null> {
  const pages = await loadPublishPages();
  return pages.find((p) => p.value === page)?.accountId || null;
}

// Publish one image post (with optional collaborators) to a single IG account.
async function publishToAccount(accountId: string, imageUrl: string, caption: string, collaborators: string[]) {
  const acc = getAccount(accountId);
  if (!acc) return { accountId, ok: false as const, error: `unknown account "${accountId}"` };
  const tok = encodeURIComponent(acc.pageAccessToken);

  // 1) create the media container. Instagram auto-invites collaborators when the
  // `collaborators` param (JSON array of usernames, max 3) is set on the container.
  let createUrl = `${GRAPH}/${acc.igUserId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption || "")}&access_token=${tok}`;
  if (collaborators.length) createUrl += `&collaborators=${encodeURIComponent(JSON.stringify(collaborators))}`;
  const createRes = await fetch(createUrl, { method: "POST" });
  const created = await createRes.json();
  if (!createRes.ok || created.error) {
    return { accountId, ok: false as const, error: `container step failed: ${created.error?.message || createRes.status}` };
  }
  const creationId = created.id as string;

  // 2) publish the container
  const pubRes = await fetch(`${GRAPH}/${acc.igUserId}/media_publish?creation_id=${encodeURIComponent(creationId)}&access_token=${tok}`, { method: "POST" });
  const published = await pubRes.json();
  if (!pubRes.ok || published.error) {
    return { accountId, ok: false as const, error: `publish step failed: ${published.error?.message || pubRes.status}` };
  }
  const mediaId = published.id as string;

  // 3) permalink (best-effort)
  let permalink: string | null = null;
  try {
    const perm = await (await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${tok}`)).json();
    permalink = perm.permalink || null;
  } catch { /* best-effort */ }

  return { accountId, ok: true as const, handle: acc.handle, mediaId, permalink };
}

export async function POST(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;
  // Publishing is the most expensive action in the product: it is public,
  // immediate and not really undoable. The "content" section alone is held by
  // the Designer, Video-editor and Content-writer presets, i.e. everyone who
  // can open the tab — so section access was deciding who could post to the
  // brand accounts. approve_content exists precisely to separate "can work on
  // a task" from "can ship it". Admins pass automatically, so this changes
  // nothing until a non-admin account exists, which is when it should bite.
  const __noCap = await requireCapability("approve_content");
  if (__noCap) return __noCap;

  try {
    const body = (await req.json()) as { accountId?: string; imageUrl?: string; caption?: string; postId?: string; collaborators?: string[] };
    let { accountId, imageUrl, caption } = body;
    const { postId } = body;
    let collaborators = (body.collaborators || []).map((s) => (s || "").trim().replace(/^@+/, "")).filter(Boolean).slice(0, 3);
    const sb = getSupabase();

    // Which accounts to publish to. Explicit accountId → just that one; otherwise the
    // post's publish_to_pages (all selected brand pages → cross-post to each).
    let accountIds: string[] = accountId ? [accountId] : [];

    if (postId && sb) {
      const { data, error } = await sb.from("mh_posts").select("media_urls, caption, publish_to_pages, collaborators").eq("id", postId).single();
      if (error) throw new Error(error.message);
      imageUrl = imageUrl || (data.media_urls as string[] | null)?.[0];
      caption = caption ?? data.caption ?? "";
      if (!collaborators.length) collaborators = ((data.collaborators as string[] | null) || []).slice(0, 3);
      if (!accountIds.length) {
        const pages = (data.publish_to_pages as string[] | null) || [];
        accountIds = (await Promise.all(pages.map(accountIdForPage))).filter((x): x is string => !!x);
      }
    }
    if (!accountIds.length) return NextResponse.json({ error: "accountId (or a post with target pages) is required" }, { status: 400 });
    // The brand pages this person may schedule to (Team & access) apply here too (A8).
    const all = await loadPublishPages();
    const __pages = await requireSchedulerPages(accountIds.map((a) => all.find((p) => p.accountId === a)?.value || a));
    if (__pages) return __pages;
    if (!imageUrl) return NextResponse.json({ error: "no media to publish (imageUrl / media_urls is empty)" }, { status: 400 });

    // Publish to every selected page.
    const results = [];
    for (const id of accountIds) results.push(await publishToAccount(id, imageUrl, caption || "", collaborators));
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // Mark the row published only if at least one page went live; link back the first permalink.
    if (postId && sb && succeeded.length) {
      await sb.from("mh_posts").update({ publish_status: "published" }).eq("id", postId);
      const firstPerma = succeeded.find((r) => r.ok && r.permalink);
      if (firstPerma && firstPerma.ok && firstPerma.permalink) await writeBackLink({ postId, platform: "instagram", url: firstPerma.permalink });
    }

    if (!succeeded.length) {
      return NextResponse.json({ error: `publish failed: ${failed.map((f) => f.error).join("; ")}`, results }, { status: 502 });
    }
    return NextResponse.json({ ok: true, published: succeeded.length, failed: failed.length, results });
  } catch (err) {
    return NextResponse.json(safeError(err, "Publish failed"), { status: 502 });
  }
}
