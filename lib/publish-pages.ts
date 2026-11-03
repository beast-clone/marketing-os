// The pages the Scheduler can post to (3 Nov 2026): the three GooCampus pages, plus
// every brand linked to Instagram/Facebook on the Brands page — a brand that is
// linked shows up here with nobody adding it. A page's `value` is what a post stores
// in publish_to_pages; for a linked brand it is its Facebook page name, which is
// also how the n8n publisher finds it.
//
// No imports: used by the server and the browser. The browser fills the linked ones
// from /api/scheduler/pages (lib/use-publish-pages.ts).
export type PublishPage = {
  value: string; label: string; handle: string; subtitle: string;
  accountId: string; color: string; linkedIn: "goocampus" | "world" | null; linked?: boolean;
};

export const CORE_PAGES: PublishPage[] = [
  { value: "GooCampus Main", label: "GooCampus", handle: "@goocampus", subtitle: "@goocampus + 2 FB pages", accountId: "goocampus", color: "#3A57E8", linkedIn: "goocampus" },
  { value: "GooCampus World", label: "GooCampus World", handle: "@goocampusworld", subtitle: "@goocampusworld + GooCampus World page", accountId: "goocampusworld", color: "#0EA5E9", linkedIn: "world" },
  { value: "12Plus / GC India", label: "12thPlus.com", handle: "@12thplusdotcom", subtitle: "@12thplusdotcom + GC India page", accountId: "12thplusdotcom", color: "#E11D48", linkedIn: null },
];

/** The live list (core first). Kept as one array so every importer sees updates. */
export const PUBLISH_PAGES: PublishPage[] = [...CORE_PAGES];

export function setLinkedPages(linked: PublishPage[]) {
  PUBLISH_PAGES.splice(CORE_PAGES.length);
  PUBLISH_PAGES.push(...linked.filter((p) => !CORE_PAGES.some((c) => c.value === p.value)));
}

/** A linked brand as a page — from what the Brands page saved when it was linked. */
export function linkedPage(accountId: string, pageName: string, igUsername: string, label?: string): PublishPage {
  return {
    value: pageName, label: label || pageName, handle: `@${igUsername}`, subtitle: `@${igUsername} + ${pageName} page`,
    accountId, color: "#8B5CF6", linkedIn: null, linked: true,
  };
}

/** What we know about a stored page value; unknown values come back as themselves. */
export function pageInfo(value: string | null | undefined): PublishPage {
  const v = value || "";
  return PUBLISH_PAGES.find((p) => p.value === v) || CORE_PAGES.find((p) => p.value === v)
    || { value: v, label: v, handle: "", subtitle: "", accountId: "", color: "#8A92A6", linkedIn: null };
}
