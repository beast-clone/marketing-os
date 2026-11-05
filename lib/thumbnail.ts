// A small WebP copy of an uploaded image, made once at upload time.
//
// The grids in this dashboard show dozens of creatives at once and were loading
// the full-size original for every tile — a 3 MB poster rendered 240px wide.
//
// Deliberately NOT next/image. Almost every image here is either a Meta CDN URL
// (already optimised by Meta, and signed so it expires) or one of our own
// uploads. Putting Next's optimiser in front would re-encode each one through
// Netlify's image CDN on every request, which is a metered usage category —
// paying per view to shrink something we could shrink once. This is the once.

import { createCanvas, loadImage } from "@napi-rs/canvas";

/** How wide a tile ever gets. 2× that, so it still looks right on a retina screen. */
export const THUMB_WIDTH = 480;
/** Below this there is nothing worth saving, and re-encoding can make it bigger. */
const WORTH_IT_BYTES = 120 * 1024;

const CAN_THUMB = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type Thumb = { buf: Buffer; mime: "image/webp"; width: number; height: number };

/** The path a thumbnail is stored at, next to its original. */
export const thumbPathFor = (storagePath: string) => `${storagePath.replace(/\.[^./]+$/, "")}.thumb.webp`;

/**
 * A WebP thumbnail of `buf`, or null when one isn't worth making.
 *
 * Returns null rather than throwing: a thumbnail is an optimisation, and a
 * corrupt or unusual image must never stop the upload it belongs to. The caller
 * stores the original either way and the UI falls back to it.
 */
export async function makeThumb(buf: Buffer, mime: string): Promise<Thumb | null> {
  if (!CAN_THUMB.has(mime)) return null;        // video, PDF — nothing to do
  if (buf.length < WORTH_IT_BYTES) return null; // already small
  try {
    const img = await loadImage(buf);
    if (!img.width || !img.height) return null;
    // Never scale up — a 300px image stays 300px.
    const width = Math.min(THUMB_WIDTH, img.width);
    const height = Math.max(1, Math.round(img.height * (width / img.width)));
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    // 82 keeps text in a carousel slide legible; below about 70 it starts to
    // smear, and these are posters people read.
    const out = await canvas.encode("webp", 82);
    // If the "thumbnail" is no smaller, there is nothing to gain by keeping it.
    if (out.length >= buf.length) return null;
    return { buf: Buffer.from(out), mime: "image/webp", width, height };
  } catch {
    return null;
  }
}

/**
 * Make a thumbnail for an object already in storage, put it beside the original,
 * and hand back its public URL. Returns null when there is nothing to make.
 *
 * `bytes` is optional because the two upload paths differ: one streams the file
 * through the server and already holds it, the other has the browser upload
 * straight to storage and knows only the path. In the second case the object is
 * fetched back once — at upload, not per view, which is the whole point.
 *
 * Never throws. A failed thumbnail must not fail the upload it belongs to.
 */
export async function storeThumb(
  sb: { storage: { from: (b: string) => {
    download: (p: string) => Promise<{ data: Blob | null }>;
    upload: (p: string, b: Buffer, o: { contentType: string; upsert: boolean }) => Promise<{ error: unknown }>;
    getPublicUrl: (p: string) => { data: { publicUrl: string } };
  } } },
  bucket: string,
  objectPath: string,
  mime: string,
  bytes?: Buffer,
): Promise<string | null> {
  try {
    if (!CAN_THUMB.has(mime)) return null;
    let buf = bytes;
    if (!buf) {
      const got = await sb.storage.from(bucket).download(objectPath);
      if (!got.data) return null;
      buf = Buffer.from(await got.data.arrayBuffer());
    }
    const thumb = await makeThumb(buf, mime);
    if (!thumb) return null;
    const path = thumbPathFor(objectPath);
    const up = await sb.storage.from(bucket).upload(path, thumb.buf, { contentType: thumb.mime, upsert: true });
    if (up.error) return null;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}
