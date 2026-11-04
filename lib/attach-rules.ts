// What a task file may be, shared by the upload routes (app/api/marketing-hub/attach*).
//
// Files land in a PUBLIC bucket and get a permanent unauthenticated URL, so whatever
// is accepted is served to anyone with the link, from an origin that looks like our
// infrastructure. Without a list, text/html or an SVG could be uploaded and would
// render — a credible phishing page, and script execution on the Supabase origin.

export const BUCKET = "scheduler-media";
// thumbnail = a reel's cover (docs/REEL_THUMBNAIL_SPEC.md): one image, never a slide.
export type AttachKind = "creative" | "reference" | "attachment" | "thumbnail";

export const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/quicktime",
  "application/pdf",
]);
export const ALLOWED_LABEL = "jpg, png, gif, webp, mp4, mov or pdf";
// Attachments are working files, not media (Manya, 10 Oct), so they also take Office
// files and CSV — all of which download rather than render, so the reasoning holds.
export const ATTACHMENT_EXTRA = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "text/csv",
]);
export const ATTACHMENT_LABEL = "an image, video, pdf, Word, Excel, PowerPoint or CSV file";

// Files go browser → storage directly (attach/sign + attach/complete), so the hosting
// limit on a request body (~6 MB on Netlify) no longer applies; this is our own cap.
// 300 MB since the project moved to the Pro plan and the Supabase global limit and
// the scheduler-media bucket were raised to match (21 Oct).
// 2 GB from 22 Oct (Praveen): the Supabase global limit and the scheduler-media bucket
// were raised to 2 GB to hold big reel masters. Instagram still only PUBLISHES reels up
// to 300 MB through the API, so a bigger file can be stored and shared, not posted.
export const MAX_MB = 2048;

export const asKind = (v: unknown): AttachKind => (v === "reference" || v === "attachment" || v === "thumbnail" ? v : "creative");
// Kinds that are not the deliverable: never published, never send a task back for review.
export const NOT_MEDIA = "(reference,attachment,thumbnail)";
export const isMediaKind = (k: unknown) => k !== "reference" && k !== "attachment" && k !== "thumbnail";

export function mimeAllowed(mime: string, kind: AttachKind): boolean {
  const m = (mime || "").toLowerCase();
  if (kind === "thumbnail") return m.startsWith("image/") && ALLOWED_MIME.has(m);
  return ALLOWED_MIME.has(m) || (kind === "attachment" && ATTACHMENT_EXTRA.has(m));
}
export const mimeRefusal = (kind: AttachKind) =>
  kind === "thumbnail" ? "A thumbnail has to be an image — jpg, png, gif or webp."
    : `That file type isn't allowed — use ${kind === "attachment" ? ATTACHMENT_LABEL : ALLOWED_LABEL}.`;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Runs of dots collapse to one: a title like "UK Prioritisation Act ... .pdf" kept its
// "..." and the upload was then refused as a "bad path" (22 Oct).
export const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, ".").replace(/^\.+/, "").slice(-120);
