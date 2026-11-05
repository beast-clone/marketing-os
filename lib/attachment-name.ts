// A filename someone can read six months from now.
//
// Designers export from Canva and Figma as numbered slides, so most of what
// lands here is called "15.png" or "379.webp" — 403 of the 603 files already
// uploaded have a name that says nothing about what they are. In a storage
// bucket, a download folder or a History entry that is useless: you cannot
// tell a Karnataka PG carousel slide from an Australia AMC one without
// opening both.
//
// So when the uploaded name carries no information, it is replaced with one
// built from the task. When it carries something — the person named the file
// deliberately — it is left exactly as it is. Guessing is worse than a plain
// name its owner chose.

/** "image", "image (1)", "image 2" — a counter the tool added, not a name. */
const COUNTER = String.raw`(?:[-_ ]?\d+|\s*\(\d+\))?`;

/** Names that are the uploader's tool talking, not the uploader. */
const SAYS_NOTHING = [
  /^\d+$/,                                   // 15, 379 — Canva slide exports
  new RegExp(`^(image|img|photo|pic|picture)${COUNTER}$`, "i"),
  new RegExp(`^(download|untitled|unnamed|file|document|doc|scan|export|new)${COUNTER}$`, "i"),
  /^screen(shot| recording)/i,
  /^whatsapp (image|video|document)/i,
  /^(pasted|clipboard)/i,
  /^\d{4}[-_]?\d{2}[-_]?\d{2}([-_ ].*)?$/,   // a bare date
  /^(IMG|DSC|PXL|VID|MVIMG)[-_]?\d+/i,       // camera and phone exports
  /^\d{10,}$/,                               // a timestamp
];

const saysNothing = (stem: string) => SAYS_NOTHING.some((re) => re.test(stem.trim()));

/** "Aus batch - Carousel" → "aus-batch-carousel" */
export function slug(s: string, max = 48): string {
  const out = (s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (out.length <= max) return out;
  // Cut on a word boundary so the name doesn't end mid-word.
  return out.slice(0, max).replace(/-[^-]*$/, "") || out.slice(0, max);
}

/**
 * What to store this file as.
 *
 * `seq` is a fallback number, used only when the uploaded name has no slide
 * number of its own — a carousel's slide numbers are real information and are
 * kept, because they are the order the slides go out in.
 *
 * Returns the original unchanged when it already means something, so this is
 * safe to put in front of every upload.
 */
export function readableName(original: string, taskTitle: string | null | undefined, kind: string, seq = 1): string {
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const ext = dot > 0 ? original.slice(dot + 1).toLowerCase() : "";
  const task = slug(taskTitle || "");
  if (!task || !saysNothing(stem)) return original;

  // "creative" adds nothing next to the task name; the other kinds distinguish.
  const part = kind && kind !== "creative" ? `-${slug(kind, 12)}` : "";
  // Only a stem that is ALL number is a slide number. The digits inside
  // "pasted-2026-10-26-125023" are a date, and reading those as the number gave
  // every paste on one task the same name.
  const slide = /^\d+$/.test(stem.trim())
    ? stem.trim()
    : stem.match(/^(?:img|image|photo|pic|picture|slide)[-_ ]?(\d+)$/i)?.[1];
  const n = String(Number(slide ?? seq)).padStart(2, "0");
  return `${task}${part}-${n}${ext ? `.${ext}` : ""}`;
}

/** The same name, safe to use inside a storage path. */
export const storageSafe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");
