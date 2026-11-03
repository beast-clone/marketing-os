import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tabForUrl } from "@/lib/permissions";

// Every page in the sidebar (outside System) must have a switch on Team & access,
// or nobody can be given — or refused — that page. Plan board shipped without one
// (3 Nov). This runs before every build, so a new page can't go live unlisted:
// add it to TABS in lib/permissions.ts.
const src = readFileSync(path.resolve(__dirname, "../../app/(dashboard)/dashboard/preview/PreviewSidebar.tsx"), "utf8");
const start = src.indexOf("const GROUPS");
const end = src.indexOf('{ label: "System", sec: "system"', start);
const hrefs = Array.from(src.slice(start, end).matchAll(/href: `\$\{HUB\}([^`]*)`/g), (m) => m[1]);

describe("sidebar pages are on Team & access", () => {
  it("found the sidebar pages", () => expect(hrefs.length).toBeGreaterThan(20));
  it.each(hrefs)("%s", (href) => {
    const [pathAndQuery] = href.split("#");
    const [p, q = ""] = pathAndQuery.split("?");
    expect(tabForUrl(`/dashboard/preview${p}`, q ? `?${q}` : "")).not.toBeNull();
  });
});
