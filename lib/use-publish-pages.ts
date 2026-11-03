"use client";
import { useSyncExternalStore } from "react";
import { PUBLISH_PAGES, setLinkedPages, type PublishPage } from "@/lib/publish-pages";

// The Scheduler's page list in the browser: the three GooCampus pages at once, then
// the linked brands when /api/scheduler/pages answers. Loaded once per page view.
let snapshot: PublishPage[] = PUBLISH_PAGES.slice();
let started = false;
const subs = new Set<() => void>();

function subscribe(fn: () => void) {
  subs.add(fn);
  if (!started) {
    started = true;
    fetch("/api/scheduler/pages", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.pages) return;
        setLinkedPages((j.pages as PublishPage[]).filter((p) => p.linked));
        snapshot = PUBLISH_PAGES.slice();
        subs.forEach((f) => f());
      })
      .catch(() => {});
  }
  return () => { subs.delete(fn); };
}

export function usePublishPages(): PublishPage[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
