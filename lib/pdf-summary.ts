// One-line English summary of a notice (Watchers — docs/WATCHERS_SPEC.md).
//
// Three ways in, best first:
//   'pdf'   — the PDF has real text (MCC's do): send that text.
//   'scan'  — the PDF is a scan (KEA prints and scans its notices on a copier, so the
//             text is a picture): draw page 1 and send the picture.
//   'title' — no readable document (a web page, a broken file): translate the link
//             text. KEA's link titles are Kannada but descriptive.
// Perplexity sonar does the reading — the dashboard's only AI provider (lib/ai.ts) —
// at roughly $0.001 a notice.
//
// pdfjs in Node needs three things it can't find on its own: its fonts, its
// character maps and its wasm decoders. Without the wasm one, the black-and-white
// text layer of a scan (CCITT / JBIG2) is silently skipped and the page renders as a
// blank letterhead (1 Oct).
import path from "node:path";
import { hasAI, recordUsage } from "@/lib/ai";
import { safeFetch } from "@/lib/ssrf";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_BYTES = 15 * 1024 * 1024;
const KEY = () => process.env.PERPLEXITY_API_KEY || process.env.PLANNER_SEARCH_KEY || "";
const ASK = "In ONE plain English sentence of at most 35 words, say what this official notice announces, who it is for, and its key dates. Be exact about which date is for what. Translate from Kannada or Hindi if needed. No preamble, no quotes.";

export type Summary = { text: string; from: "pdf" | "scan" | "title" };

// Its runtime files sit in node_modules next to the app — locally and on Netlify,
// where next.config's outputFileTracingIncludes copies them into the function.
const pdfjsDir = () => path.join(process.cwd(), "node_modules", "pdfjs-dist");

async function download(url: string): Promise<Uint8Array | null> {
  try {
    // This URL came off a third-party page the watcher scraped, so it is not
    // just user-supplied, it is attacker-supplyable: a watched board can link
    // anywhere. Check before fetching, same as lib/watchers.ts fetchPage.
    // safeFetch checks the address and every redirect hop before requesting it.
    const r = await safeFetch(url, { headers: { "User-Agent": UA }, timeoutMs: 30_000, cache: "no-store" });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return buf.length > MAX_BYTES || String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-" ? null : buf;
  } catch { return null; }
}

// Text of the first pages, or a JPEG of page 1 when there is no text.
async function readPdf(data: Uint8Array): Promise<{ text?: string; image?: string } | null> {
  const dir = pdfjsDir();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // These PDFs are wholly untrusted: the URL comes from a link scraped off a
  // watched notice board, so anyone who can get a file linked from one of those
  // pages decides what this parser is handed — and it runs in the function that
  // holds the Supabase service-role key and every third-party token.
  //
  // pdfjs-dist is pinned >=6.2.108 for the advisory "arbitrary JavaScript
  // execution upon opening a malicious PDF" (affected >=5.6.83 <6.2.108). Do not
  // relax that floor. There is deliberately no isEvalSupported:false here: that
  // option no longer exists in v6 — eval was removed from the library outright,
  // which is why passing it is a type error rather than a safety net.
  const task = getDocument({
    data, disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, verbosity: 0,
    cMapUrl: `${dir}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${dir}/standard_fonts/`, wasmUrl: `${dir}/wasm/`,
  });
  const doc = await task.promise;
  try {
    let text = "";
    for (let p = 1; p <= Math.min(3, doc.numPages); p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      text += c.items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length >= 120) return { text: text.slice(0, 6000) };
    const { createCanvas } = await import("@napi-rs/canvas");
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1.6 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdfjs's types expect a DOM canvas; @napi-rs/canvas implements the same 2D API.
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp, canvas: canvas as unknown as HTMLCanvasElement }).promise;
    const jpg = await canvas.encode("jpeg", 80);
    return { image: `data:image/jpeg;base64,${Buffer.from(jpg).toString("base64")}` };
  } finally { await task.destroy(); }
}

async function ask(content: unknown): Promise<string> {
  const t0 = Date.now();
  const r = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "sonar", disable_search: true, max_tokens: 160, temperature: 0.1, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) { const e = new Error(`Perplexity ${r.status}`); recordUsage("watchers", "sonar", null, e, undefined, Date.now() - t0); throw e; }
  const j = await r.json();
  const u = j.usage || {};
  recordUsage("watchers", "sonar", { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, total: u.total_tokens || 0, cost: u.cost?.total_cost }, undefined, undefined, Date.now() - t0);
  return String(j.choices?.[0]?.message?.content || "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
}

export async function summarizeNotice(title: string | null, url: string): Promise<Summary | null> {
  if (!hasAI()) return null;
  const isPdf = /\.pdf(\?|$)/i.test(url);
  if (isPdf) {
    const data = await download(url);
    const read = data ? await readPdf(data).catch(() => null) : null;
    if (read?.text) return { text: await ask(`${ASK}\n\nNotice title: ${title || "(none)"}\n\nNotice text:\n${read.text}`), from: "pdf" };
    if (read?.image) return { text: await ask([{ type: "text", text: `${ASK}\n\nNotice title: ${title || "(none)"}` }, { type: "image_url", image_url: { url: read.image } }]), from: "scan" };
  }
  if (!title || title.length < 8) return null;
  return { text: await ask(`${ASK}\n\nYou only have the notice's title (the document itself couldn't be read), so summarise just what the title says:\n${title}`), from: "title" };
}
