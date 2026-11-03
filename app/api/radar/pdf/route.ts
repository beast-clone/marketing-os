import { requireSection } from "@/lib/api-guard";
import { assertPublicUrl, safeFetch } from "@/lib/ssrf";

// PDF proxy for the in-dashboard reader. Some publishers (e.g. natboard.edu.in's
// viewNotice.php) serve PDFs only to a real browser UA and block Google's viewer,
// so we can't embed via docs.google.com/gview. Instead we fetch the PDF server-side
// (same trusted path as /api/radar/article) and stream the bytes back same-origin,
// letting Chrome's built-in PDF viewer render it in the iframe. SSRF-guarded.
export const dynamic = "force-dynamic";

const MAX_URL_LEN = 2000;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB cap

export async function GET(req: Request) {
  const __denied = await requireSection("content");
  if (__denied) return __denied;

  const target = new URL(req.url).searchParams.get("url") || "";
  if (!target || target.length > MAX_URL_LEN) return new Response("bad url", { status: 400 });
  try { new URL(target); } catch { return new Response("bad url", { status: 400 }); }
  try { await assertPublicUrl(target); } catch { return new Response("blocked", { status: 400 }); }

  try {
    // Every redirect hop is checked before it's requested (lib/ssrf safeFetch).
    const r = await safeFetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "Accept": "application/pdf,*/*",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      timeoutMs: 25_000,
    });
    if (!r.ok) return new Response("fetch failed", { status: 502 });

    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_PDF_BYTES) return new Response("pdf too large", { status: 413 });

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("pdf proxy error", { status: 502 });
  }
}
