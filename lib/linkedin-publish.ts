import { linkedinToken } from "@/lib/linkedin";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// Shared LinkedIn org-page publishing — used by the immediate publish route AND the
// scheduled-publish cron worker. Requires an access token with `w_organization_social`.

const REST = "https://api.linkedin.com/rest";
const VERSION = process.env.LINKEDIN_VERSION || "202607";

export type LinkedInPublishResult =
  | { page: string; ok: true; orgUrn: string; postUrn: string; permalink: string | null }
  | { page: string; ok: false; error: string };

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

// Map a page label/key to the org URN we hold in env. Accepts "goocampus"/"world"
// and the fuller labels used in the composer ("LinkedIn — GooCampus", etc.).
export function orgUrnFor(page: string): string | null {
  const p = (page || "").toLowerCase();
  if (/world/.test(p)) return process.env.LINKEDIN_ORG_URN_GCWORLD || null;
  if (/goocampus|main|edu|india|12th/.test(p)) return process.env.LINKEDIN_ORG_URN_GOOCAMPUS || null;
  return null;
}

// Register + upload an image, returning its urn:li:image:... for use in a post.
async function uploadImage(token: string, orgUrn: string, imageUrl: string): Promise<string> {
  const initRes = await fetchWithTimeout(`${REST}/images?action=initializeUpload`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: orgUrn } }),
  });
  const init = await initRes.json();
  if (!initRes.ok) throw new Error(`image init ${initRes.status}: ${JSON.stringify(init).slice(0, 200)}`);
  const uploadUrl: string = init.value?.uploadUrl;
  const imageUrn: string = init.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error("image init returned no uploadUrl/urn");

  const src = await fetchWithTimeout(imageUrl);
  if (!src.ok) throw new Error(`could not fetch source image (${src.status})`);
  const bytes = Buffer.from(await src.arrayBuffer());

  const up = await fetchWithTimeout(uploadUrl, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: bytes });
  if (!up.ok) throw new Error(`image upload failed (${up.status})`);
  return imageUrn;
}

export const isPdfUrl = (u?: string | null) => !!u && /\.pdf(\?|#|$)/i.test(u);

// Register + upload a PDF, returning its urn:li:document:... .
//
// This is what makes a LinkedIn carousel work. Posting a deck as separate images
// lets LinkedIn reorder them; posted as ONE document, the slides stay in the
// order they were exported and the reader swipes through them. Documents use a
// different endpoint from images and the post body needs a title.
async function uploadDocument(token: string, orgUrn: string, pdfUrl: string): Promise<string> {
  const initRes = await fetchWithTimeout(`${REST}/documents?action=initializeUpload`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: orgUrn } }),
  });
  const init = await initRes.json();
  if (!initRes.ok) throw new Error(`document init ${initRes.status}: ${JSON.stringify(init).slice(0, 200)}`);
  const uploadUrl: string = init.value?.uploadUrl;
  const documentUrn: string = init.value?.document;
  if (!uploadUrl || !documentUrn) throw new Error("document init returned no uploadUrl/urn");

  const src = await fetchWithTimeout(pdfUrl);
  if (!src.ok) throw new Error(`could not fetch source PDF (${src.status})`);
  const bytes = Buffer.from(await src.arrayBuffer());

  const up = await fetchWithTimeout(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: bytes });
  if (!up.ok) throw new Error(`document upload failed (${up.status})`);
  return documentUrn;
}

// Title shown above the document carousel. LinkedIn requires a non-empty one;
// use the post's first line, falling back to the filename.
function documentTitle(text: string, pdfUrl: string): string {
  const firstLine = (text || "").split("\n").map((s) => s.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 100);
  const name = decodeURIComponent(pdfUrl.split("/").pop() || "").replace(/\.pdf$/i, "");
  return (name || "Document").slice(0, 100);
}

// Upload a post's image or PDF without posting it — the cron does this up to 30 min
// before the post's time, so at the time only the post itself is created.
export async function uploadMedia(token: string, orgUrn: string, url: string): Promise<string> {
  return isPdfUrl(url) ? uploadDocument(token, orgUrn, url) : uploadImage(token, orgUrn, url);
}

// Publish one post to one org page. Returns the new post URN. `mediaUrn` is an image
// or document already uploaded for this exact imageUrl (see uploadMedia).
export async function publishToOrg(token: string, orgUrn: string, text: string, imageUrl?: string | null, mediaUrn?: string | null): Promise<string> {
  const body: Record<string, unknown> = {
    author: orgUrn,
    commentary: text || "",
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageUrl) {
    if (isPdfUrl(imageUrl)) {
      const documentUrn = mediaUrn || await uploadDocument(token, orgUrn, imageUrl);
      body.content = { media: { id: documentUrn, title: documentTitle(text, imageUrl) } };
    } else {
      const imageUrn = mediaUrn || await uploadImage(token, orgUrn, imageUrl);
      body.content = { media: { id: imageUrn } };
    }
  }
  const r = await fetchWithTimeout(`${REST}/posts`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`post ${r.status}: ${(await r.text()).slice(0, 250)}`);
  return r.headers.get("x-restli-id") || r.headers.get("x-linkedin-id") || "";
}

// Publish the same post to one or more pages. Never throws — returns a result per page.
export type PreparedMedia = Record<string, { src: string; urn: string }>;

export async function publishToPages(pages: string[], text: string, imageUrl?: string | null, prepared?: PreparedMedia | null): Promise<LinkedInPublishResult[]> {
  const token = await linkedinToken();
  if (!token) return pages.map((page) => ({ page, ok: false as const, error: "LinkedIn not connected (no access token)" }));

  const results: LinkedInPublishResult[] = [];
  for (const page of pages) {
    const orgUrn = orgUrnFor(page);
    if (!orgUrn) { results.push({ page, ok: false, error: `unknown page "${page}"` }); continue; }
    try {
      const ready = prepared?.[page];
      const postUrn = await publishToOrg(token, orgUrn, text || "", imageUrl, ready && ready.src === imageUrl ? ready.urn : null);
      results.push({ page, ok: true, orgUrn, postUrn, permalink: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : null });
    } catch (e) {
      results.push({ page, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
