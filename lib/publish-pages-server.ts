import { warmBrandAccounts, readRegistry } from "@/lib/brand-accounts";
import { getConfiguredAccounts } from "@/lib/instagram";
import { ACCOUNTS } from "@/lib/accounts";
import { CORE_PAGES, linkedPage, setLinkedPages, PUBLISH_PAGES, type PublishPage } from "@/lib/publish-pages";

// Server side of lib/publish-pages.ts: the linked brands, from the accounts the Brands
// page connected (warmBrandAccounts, cached a minute).
export async function loadPublishPages(): Promise<PublishPage[]> {
  await warmBrandAccounts();
  const core = new Set(CORE_PAGES.map((p) => p.accountId));
  // A brand connected with "Connect Instagram only" has an Instagram key (IG…) and no
  // Facebook page; its page is named by its @handle and posts to Instagram only.
  const added = (await readRegistry()).added;
  const nameOf = (id: string) => ACCOUNTS.find((x) => x.id === id)?.label || added.find((x) => x.id === id)?.label;
  const linked = getConfiguredAccounts()
    .filter((a) => !core.has(a.id) && a.label && a.handle && (a.pageId || a.pageAccessToken.startsWith("IG")))
    .map((a) => linkedPage(a.id, a.label, a.handle.replace(/^@/, ""), nameOf(a.id), !a.pageId));
  setLinkedPages(linked);
  return PUBLISH_PAGES.slice();
}
