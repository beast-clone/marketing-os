"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { alertDialog } from "@/app/(dashboard)/dashboard/preview/ConfirmDialog";

const TAB_LABELS: Record<string, string> = {
  "": "Overview",
  posts: "Posts",
  reels: "Reels",
  stories: "Stories",
  audience: "Audience",
  hashtags: "Hashtags",
  discover: "Discover",
  ads: "Ads",
  competitors: "Competitor Ads",
  benchmark: "Benchmark",
  "ai-insights": "AI Insights",
  "ai-reports": "AI Reports",
  inbox: "Inbox",
  dms: "DMs",
  leads: "Leads",
};

function tabKey(pathname: string | null): string {
  if (!pathname) return "";
  const m = pathname.match(/\/dashboard\/?(.*)/);
  return (m?.[1] || "").split("/")[0];
}

export function PdfExportButton({ accountId, range }: { accountId: string; range: { from: string; to: string } }) {
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const key = tabKey(pathname);
  const tabLabel = TAB_LABELS[key] ?? "Dashboard";

  async function exportPdf() {
    if (busy) return;
    setBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const target = document.querySelector("main") as HTMLElement | null;
      if (!target) throw new Error("Main content not found");

      // Wait for in-flight data fetches.
      const loadingPattern = /Loading|Fetching|Querying|Analyzing|Building/i;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const stillLoading = Array.from(target.querySelectorAll("div, p, span"))
          .some((el) => loadingPattern.test((el.textContent || "").trim().slice(0, 60)));
        if (!stillLoading) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      await new Promise((r) => setTimeout(r, 500));

      // Force every lazy image to load before the screenshot.
      //
      // html2canvas paints what the browser has already decoded, and a lazy
      // image below the fold has never been fetched — it comes out blank in the
      // PDF with nothing to say why. Flip them all to eager and wait, capped so
      // that one dead URL cannot hang the export.
      const imgs = Array.from(target.querySelectorAll("img"));
      imgs.forEach((im) => { im.loading = "eager"; });
      await Promise.race([
        Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise<void>((res) => {
          im.addEventListener("load", () => res(), { once: true });
          im.addEventListener("error", () => res(), { once: true });
        })))),
        new Promise((r) => setTimeout(r, 8000)),
      ]);

      const hidden: HTMLElement[] = Array.from(target.querySelectorAll(".no-print"));
      hidden.forEach((el) => (el.style.visibility = "hidden"));

      // ---- PDF setup ----
      // Measure widest section so we can size the PDF page big enough that nothing
      // gets shrunk below ~85% of its on-screen size. Keeps the A4-like 1:1.41 aspect.
      const sectionEls = Array.from(target.children) as HTMLElement[];
      const maxSecPx = Math.max(
        720,
        ...sectionEls.filter((el) => el.offsetHeight > 0).map((el) => el.scrollWidth),
      );
      // 1 CSS pixel ≈ 0.75 pt at native size. Scaling factor 0.9 keeps things readable.
      const targetImgW = Math.round(maxSecPx * 0.9 * 0.75);
      const sideMargin = 24;
      const pdfWidth = targetImgW + sideMargin * 2;
      const pdfHeight = Math.round(pdfWidth * 1.414);  // A4-like portrait aspect

      const pdf = new jsPDF({ unit: "pt", format: [pdfWidth, pdfHeight], orientation: "portrait" });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const headerH = 38;
      const footerH = 22;
      const sectionGap = 14;
      const usableTop = headerH + 14;
      const usableBottom = pdfH - footerH - 8;
      const imgW = pdfW - sideMargin * 2;

      const headerText = `GooCampus  -  ${tabLabel}  -  ${accountId}  -  ${range.from} to ${range.to}`;
      const footerText = `Generated ${new Date().toLocaleString()}`;

      let pageNum = 0;
      let cursorY = 0;

      function startPage() {
        if (pageNum > 0) pdf.addPage();
        pageNum += 1;
        // Header bar
        pdf.setFillColor(124, 58, 237);
        pdf.rect(0, 0, pdfW, headerH, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(11);
        pdf.text(headerText, sideMargin, 21);
        // Footer
        pdf.setTextColor(120, 120, 120);
        pdf.setFontSize(8);
        pdf.text(footerText, sideMargin, pdfH - 6);
        cursorY = usableTop;
      }

      // Walk direct children of <main>. Each becomes one or more PDF blocks.
      const sections = Array.from(target.children) as HTMLElement[];

      startPage();
      let blockCount = 0;

      for (const sec of sections) {
        if (sec.classList.contains("no-print")) continue;
        // Skip hidden / zero-size
        if (sec.offsetHeight === 0 || sec.offsetWidth === 0) continue;

        // Render this section at scale 2 for crispness.
        let secCanvas: HTMLCanvasElement;
        try {
          secCanvas = await html2canvas(sec, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#f9fafb",
            logging: false,
            windowWidth: sec.scrollWidth,
            windowHeight: sec.scrollHeight,
          });
        } catch {
          continue;
        }

        const ratio = imgW / secCanvas.width;
        const fullH = secCanvas.height * ratio;
        const pagePayloadH = usableBottom - usableTop;

        // If the whole section fits on the current page in remaining space, drop it.
        if (cursorY + fullH <= usableBottom) {
          const img = secCanvas.toDataURL("image/jpeg", 0.92);
          pdf.addImage(img, "JPEG", sideMargin, cursorY, imgW, fullH);
          cursorY += fullH + sectionGap;
          blockCount += 1;
          continue;
        }

        // Section doesn't fit in current page's remaining space.
        // If it fits in a fresh page, start a new page and place it whole.
        if (fullH <= pagePayloadH) {
          startPage();
          const img = secCanvas.toDataURL("image/jpeg", 0.92);
          pdf.addImage(img, "JPEG", sideMargin, cursorY, imgW, fullH);
          cursorY += fullH + sectionGap;
          blockCount += 1;
          continue;
        }

        // Section is taller than a whole page — split its canvas across pages.
        const sliceCanvasH = pagePayloadH / ratio; // pixels of source per page
        let consumed = 0;
        // If there's already content on this page, finish it first.
        if (cursorY > usableTop) startPage();

        while (consumed < secCanvas.height) {
          const slice = document.createElement("canvas");
          slice.width = secCanvas.width;
          slice.height = Math.min(sliceCanvasH, secCanvas.height - consumed);
          const ctx = slice.getContext("2d");
          if (!ctx) break;
          ctx.fillStyle = "#f9fafb";
          ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(
            secCanvas,
            0, consumed, secCanvas.width, slice.height,
            0, 0, slice.width, slice.height,
          );
          const sliceImg = slice.toDataURL("image/jpeg", 0.92);
          const sliceImgH = slice.height * ratio;
          pdf.addImage(sliceImg, "JPEG", sideMargin, usableTop, imgW, sliceImgH);
          consumed += slice.height;
          if (consumed < secCanvas.height) startPage();
          else cursorY = usableTop + sliceImgH + sectionGap;
        }
        blockCount += 1;
      }

      // Add page numbers now that we know totalPages.
      const totalPages = pageNum;
      for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(9);
        pdf.text(`Page ${p} / ${totalPages}`, pdfW - sideMargin, 21, { align: "right" });
      }

      hidden.forEach((el) => (el.style.visibility = ""));

      if (blockCount === 0) throw new Error("No content was captured");

      const safeAcct = accountId.replace(/[^\w-]+/g, "");
      const safeRange = `${range.from}_to_${range.to}`;
      pdf.save(`GooCampus-${tabLabel}-${safeAcct}-${safeRange}.pdf`);
    } catch (err) {
      console.error("[pdf] export failed:", err);
      alertDialog(`PDF export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={exportPdf}
      disabled={busy}
      className="bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl px-3.5 py-2 transition flex items-center gap-1.5 shadow-sm no-print"
      title={`Export ${tabLabel} as PDF`}
    >
      {busy ? (
        <>
          <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Building…
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <polyline points="9 15 12 18 15 15" />
          </svg>
          PDF
        </>
      )}
    </button>
  );
}
