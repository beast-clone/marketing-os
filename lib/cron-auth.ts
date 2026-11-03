import { timingSafeEqual } from "node:crypto";

// Compares a job's x-cron-secret header with CRON_SECRET in constant time, so the
// secret can't be worked out from how long a wrong guess takes (security audit,
// 3 Nov 2026). A missing secret on either side never matches.
export function sameSecret(given: string | null | undefined, secret: string | null | undefined): boolean {
  if (!given || !secret) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
