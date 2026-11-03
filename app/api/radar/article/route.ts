import { NextResponse } from "next/server";
import { requireSection } from "@/lib/api-guard";
import { FetchTimeoutError } from "@/lib/fetch-with-timeout";
import { safeError } from "@/lib/errors";
import { assertPublicUrl, safeFetch } from "@/lib/ssrf";

// jsdom + readability are loaded lazily inside GET (not at module top level):
// jsdom 29 pulls html-encoding-sniffer 6 → the ESM-only @exodus/bytes, which
// Next's CJS require-hook can't load during build-time page-data collection.
// Deferring the import keeps the build passing; they load in the Node runtime.
type JSDOMInstance = { window: { document: Document } };
type JSDOMCtor = new (html: string, opts?: { url?: string }) => JSDOMInstance;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A serverless function without an explicit budget is killed at the platform
// default (10s on Netlify), but this route's own waits used to add up to 28s
// (8s HEAD + 20s GET). Slow publishers therefore blew the 10s ceiling and the
// function was killed mid-request: nothing was ever written to the body, and the
// browser's .json() failed with "Unexpected end of JSON input" instead of saying
// anything about the article.
//
// 26s is the ceiling for a synchronous function on Netlify Pro; asking for more is
// clamped, not granted. This raise is headroom for the jsdom + Readability parse
// after the fetch, not permission to wait longer upstream — FETCH_BUDGET_MS below
// is what keeps the upstream waits bounded, and it stays inside the unraised 10s
// default so the route still returns its own JSON error if this line is ignored.
export const maxDuration = 26;

// In-dashboard reader. Fetches the article HTML directly, runs Mozilla
// Readability (the same engine Firefox Reader View uses) to strip nav / ads /
// footer, and returns cleaned HTML for inline rendering.
//
// Self-hosted so we don't depend on external reader APIs with trial limits.

const MAX_URL_LEN = 2000;
const MAX_HTML_LEN = 2_000_000; // 2MB HTML cap before Readability
const MAX_CONTENT_LEN = 200_000; // trim response body

// One wall-clock budget shared by every upstream wait in a single request, rather
// than a separate timeout per fetch. Per-fetch timeouts add up (the old 8s + 20s
// reached 28s), and whatever they add up to has to fit the platform's ceiling or
// the function is killed with no body written — which is exactly the bug this
// guards against. The number is deliberately under Netlify's 10s default rather
// than under the raised `maxDuration` above: per-route maxDuration support is not
// something to bet correctness on, so the route stays inside the floor it is
// guaranteed, and the raised budget is headroom for the parse below, not a licence
// to wait longer upstream.
const FETCH_BUDGET_MS = 7_000;

// Time left in this request's budget, floored so a nearly-exhausted budget still
// makes a real attempt instead of aborting instantly.
function remainingMs(startedAt: number): number {
  return Math.max(1_500, FETCH_BUDGET_MS - (Date.now() - startedAt));
}

function looksLikeUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch { return false; }
}

// SSRF guard: reject URLs whose host is (or resolves to) a private / loopback /
// link-local / cloud-metadata address, so a logged-in user can't turn this
// article reader into a probe of internal services.
// Sanitize the reader HTML before it goes to the client (rendered via
// dangerouslySetInnerHTML). Readability strips <script>, but NOT event-handler
// attributes, so `<img src=x onerror=...>` / `<svg onload=...>` survive and fire
// when inserted through innerHTML. Scrub them here (JSDOM is already a dep):
//  - remove executable / embedding elements (svg/math can carry handlers too)
//  - drop every on* attribute
//  - neutralise javascript:/vbscript: URLs on link/src attributes
function sanitizeArticleHtml(JSDOM: JSDOMCtor, rawHtml: string): string {
  const frag = new JSDOM(`<!doctype html><body>${rawHtml}</body>`);
  const d = frag.window.document;
  d.querySelectorAll("script,noscript,style,iframe,object,embed,form,base,link,meta,template,svg,math").forEach((el: Element) => el.remove());
  const BAD_PROTO = /^\s*(javascript|vbscript):/i;
  const URL_ATTRS = new Set(["href", "src", "xlink:href", "srcset", "formaction", "action", "background", "poster"]);
  for (const el of Array.from(d.querySelectorAll("*")) as Element[]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if (URL_ATTRS.has(name) && BAD_PROTO.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  return d.body.innerHTML;
}

export async function GET(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  const u = new URL(req.url);
  const target = u.searchParams.get("url") || "";
  if (!target || target.length > MAX_URL_LEN || !looksLikeUrl(target)) {
    return NextResponse.json({ error: "url query param must be a valid http(s) URL" }, { status: 400 });
  }
  try { await assertPublicUrl(target); } catch { return NextResponse.json({ error: "That URL isn't allowed." }, { status: 400 }); }

  // Loaded here (not at module top) — see note by the imports. Guarded, because a
  // throw out here used to escape the handler completely: the function died before
  // writing any body, so the browser's .json() reported "Unexpected end of JSON
  // input" and the real reason never reached either the user or the logs.
  //
  // It can genuinely throw: jsdom's tree contains ESM-only packages (@exodus/bytes
  // via html-encoding-sniffer, @csstools/css-calc via cssstyle) and jsdom is in
  // Next's default external-packages list, so it is require()d rather than bundled.
  // That require only works on a runtime with require(esm) — Node >= 22.12. Netlify
  // runs Node 24 so production is fine, but an older local Node fails here, and
  // that difference should surface as a readable error, not a blank 500.
  let JSDOM: JSDOMCtor;
  let Readability: typeof import("@mozilla/readability").Readability;
  try {
    ({ JSDOM } = (await import("jsdom")) as unknown as { JSDOM: JSDOMCtor });
    ({ Readability } = await import("@mozilla/readability"));
  } catch (err) {
    console.error("[radar/article] reader engine failed to load:", err);
    return NextResponse.json(
      { error: "The reader engine couldn't start on the server. Open the original link instead." },
      { status: 500 },
    );
  }

  const startedAt = Date.now();

  try {
    const resolved = target;

    // Fetch the article HTML with a browser-like UA so publishers don't hand
    // back a mobile stub or a bot-detection page.
    // Redirects are followed by safeFetch, which checks each hop before requesting it.
    const r = await safeFetch(resolved, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      timeoutMs: remainingMs(startedAt),
    });
    if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
    // PDFs (e.g. official exam notices / web notices) can't go through Readability —
    // the raw bytes render as mojibake. Detect them and hand back a flag so the
    // reader embeds the PDF (via the Google viewer) instead of parsing it as HTML.
    const ctype = (r.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("application/pdf") || /\.pdf(?:$|[?#])/i.test(resolved)) {
      return NextResponse.json({ isPdf: true, finalUrl: r.url || resolved, title: null });
    }
    const html = await r.text();
    if (html.length > MAX_HTML_LEN) {
      throw new Error("Article HTML too large");
    }

    // Run Readability against a JSDOM window built from the fetched HTML.
    const dom = new JSDOM(html, { url: r.url || resolved });
    const doc = dom.window.document;

    // Meta fallbacks — every publisher sets these even on JS-heavy pages.
    const metaTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content")
      || doc.querySelector("title")?.textContent
      || null;
    const metaDescription = doc.querySelector('meta[property="og:description"]')?.getAttribute("content")
      || doc.querySelector('meta[name="description"]')?.getAttribute("content")
      || null;
    const metaImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || null;
    const metaSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") || null;

    // Readability. Lower the charThreshold so shorter articles (news briefs)
    // don't get rejected.
    const article = new Readability(doc, { charThreshold: 200 }).parse();

    if (article && article.content && (article.textContent?.length ?? 0) > 200) {
      const content = sanitizeArticleHtml(JSDOM,
        article.content.length > MAX_CONTENT_LEN
          ? article.content.slice(0, MAX_CONTENT_LEN) + "<p><em>…(truncated)</em></p>"
          : article.content,
      );
      return NextResponse.json({
        title: article.title || metaTitle,
        byline: article.byline || null,
        excerpt: article.excerpt || metaDescription || null,
        siteName: article.siteName || metaSite,
        finalUrl: r.url || resolved,
        html: content,
        textLen: article.textContent?.length ?? 0,
      });
    }

    // Fallback: use the OG description as a mini-article. Better than nothing —
    // most publishers pack their lede paragraph into og:description.
    if (metaDescription) {
      const fallbackHtml = sanitizeArticleHtml(JSDOM, `${metaImage ? `<img src="${metaImage}" alt="" />` : ""}<p>${metaDescription}</p><p><em>This publisher renders the full article via JavaScript, so only the summary is available inline. Use "Open on the site" below for the full text.</em></p>`);
      return NextResponse.json({
        title: metaTitle,
        byline: null,
        excerpt: metaDescription,
        siteName: metaSite,
        finalUrl: r.url || resolved,
        html: fallbackHtml,
        textLen: metaDescription.length,
        fallback: true,
      });
    }

    return NextResponse.json({
      title: metaTitle,
      finalUrl: r.url || resolved,
      html: "",
      error: "This site renders its article via JavaScript so extraction returned nothing. Open the original link to read it.",
    });
  } catch (err) {
    // A timeout here is an ordinary outcome, not a fault — plenty of publishers are
    // just slower than the budget. Say that in words the reader can act on, rather
    // than passing safeError's literal "Upstream request timed out after 7000ms"
    // through to the UI.
    if (err instanceof FetchTimeoutError) {
      return NextResponse.json(
        { error: "That site took too long to respond. Open the original link to read it." },
        { status: 504 },
      );
    }
    return NextResponse.json(safeError(err, "Article fetch failed"), { status: 502 });
  }
}
