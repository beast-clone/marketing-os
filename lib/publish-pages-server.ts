import { warmBrandAccounts } from "@/lib/brand-accounts";
import { getConfiguredAccounts } from "@/lib/instagram";
import { ACCOUNTS } from "@/lib/accounts";
import { CORE_PAGES, linkedPage, setLinkedPages, PUBLISH_PAGES, type PublishPage } from "@/lib/publish-pages";

// Server side of lib/publish-pages.ts: the linked brands, from the accounts the Brands
// page connected (warmBrandAccounts, cached a minute).
export async function loadPublishPages(): Promise<PublishPage[]> {
  await warmBrandAccounts();
  const core = new Set(CORE_PAGES.map((p) => p.accountId));
  const linked = getConfiguredAccounts()
    .filter((a) => !core.has(a.id) && a.pageId && a.label && a.handle)
    .map((a) => linkedPage(a.id, a.label, a.handle.replace(/^@/, ""), ACCOUNTS.find((x) => x.id === a.id)?.label));
  setLinkedPages(linked);
  return PUBLISH_PAGES.slice();
}
