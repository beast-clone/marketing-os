// An attachment's storage path has to be readable by a person opening the
// bucket, and it has to be reproducible — the route recomputes it on every
// request to find the copy it saved last time.
import { describe, it, expect } from "vitest";
import { mediaPath } from "@/lib/wa-inbox";

const row = (over = {}) => ({ contact: "919837479850", kind: "image", created_at: "2026-11-05T14:44:00.000Z", ...over });
const media = (over = {}) => ({ id: "1234567890996812", mime: "image/jpeg", filename: null, caption: null, ...over });

describe("where a WhatsApp attachment is kept", () => {
  it("says whose number, which day, what time and what it is", () => {
    // 14:44 UTC is 20:14 IST — the day and time a person here would call it.
    expect(mediaPath(row(), media())).toBe("919837479850/2026-11-05/2014-image-996812.jpg");
  });

  it("keeps a document's own filename, which is the best label there is", () => {
    expect(mediaPath(row({ kind: "document" }), media({ mime: "application/pdf", filename: "NEET scorecard.pdf" })))
      .toBe("919837479850/2026-11-05/NEET_scorecard.pdf");
  });

  it("never loses the extension, so the browser knows what it is", () => {
    for (const [mime, ext] of [["image/png", "png"], ["application/pdf", "pdf"], ["audio/ogg", "ogg"], ["video/mp4", "mp4"]]) {
      expect(mediaPath(row(), media({ mime }))).toMatch(new RegExp("\." + ext + "$"));
    }
    // Something unheard-of still gets a usable suffix rather than none.
    expect(mediaPath(row(), media({ mime: "application/x-weird" }))).toMatch(/\.x-weird$|\.xweird$/);
  });

  it("keeps two photos in the same minute apart", () => {
    const a = mediaPath(row(), media({ id: "111111111111AAA" }));
    const b = mediaPath(row(), media({ id: "111111111111BBB" }));
    expect(a).not.toBe(b);
  });

  it("gives the same answer every time, or the cached copy is never found again", () => {
    expect(mediaPath(row(), media())).toBe(mediaPath(row(), media()));
  });

  it("is not the bare Meta id it used to be", () => {
    // The old scheme: a 16-digit number, no folders, no extension.
    expect(mediaPath(row(), media())).not.toBe("1234567890996812");
  });
});
