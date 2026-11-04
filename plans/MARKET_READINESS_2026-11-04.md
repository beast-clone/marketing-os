# Market readiness — GooCampus Marketing OS

_Research, 4 Nov 2026, against commit 65555d5. Read-only: no code was changed. Four parallel audits (security, architecture, reliability/compliance, product/UX). Spot-checked findings are marked ✔._

## Verdict

As an **internal tool** it is well above average: real data everywhere, scrypt passwords, signed sessions, CSRF check, server-side permission checks on ~280 routes, SSRF guard, hashed OAuth/MCP tokens, security headers, command palette, shortcuts, dark mode, PWA.

As a **product you sell**, it is not ready, and the main reason is structural, not cosmetic: **it is built for exactly one company.** There is no "workspace/organisation" anywhere in the data. The team, brands, Instagram accounts, Airtable bases, owner rules (who gets statics, who gets which brand's videos) and IST time are written into the code.

## The first decision (everything else depends on it)

| Option | What it means | Effort | Fit |
|---|---|---|---|
| **A. One copy per customer** ("managed install") | Each client gets their own Supabase + Netlify site; you set it up for them | Low–medium: remove hard-coding, make setup repeatable | Good for 3–10 agency-style clients |
| **B. True SaaS** (sign up, pay, use) | One app, many companies, isolated by `org_id` + row-level security | High: several engineer-months | Needed to scale to hundreds |

Recommendation: **start with A**, design changes so they also move you toward B.

---

## 1. Security

| # | Gap | Why it matters | Effort |
|---|---|---|---|
| S1 | No tenant isolation; all DB access uses one all-powerful service key ✔ | Any missed filter = one customer sees another's data | L |
| S2 | Social tokens (Meta, LinkedIn, YouTube) stored **unencrypted** in `mh_integration_tokens` ✔ | A DB leak hands over every brand's publishing access | M |
| S3 | Row-level security only on some tables; ~21 core tables have no `CREATE TABLE` in the repo | Can't prove the DB is locked down | M |
| S4 | No 2-factor login; login limit is per server instance, per IP only | Admins can post to brand accounts with just a password | M |
| S5 | Sign-out/password reset doesn't reliably kill an old cookie until midnight | Stolen cookie keeps working | S |
| S6 | Content-Security-Policy allows inline/eval scripts | Removes the safety net if any XSS slips through | M |
| S7 | Content Radar article HTML cleaned by a hand-written filter, not DOMPurify ✔ | Realistic XSS path from outside websites | S |
| S8 | `npm audit`: 2 critical (Next.js, DOMPurify), 4 high | Known, published vulnerabilities | S–M |
| S9 | Cron secret can mint an admin session ✔; MCP key accepted in URL path | One leaked secret = admin | S |
| S10 | Uploads trust the file type the browser claims; all files are public URLs | Client files guessable/shareable | S–M |
| S11 | Plaintext credential files sit in the project folder on the SSD (gitignored) | Losing/copying the SSD leaks everything | S |

Buyer expectations beyond code: SSO (Google Workspace/Microsoft), audit log of admin actions, a security page, and later **SOC 2 / ISO 27001** for bigger clients.

## 2. Reliability & operations

- **No CI** (no automatic test/type check before merge); build runs 1 of 7 test files.
- **Tests cover helpers only** — 0 tests for publishing, permissions, login, leads, crons.
- **No error tracking** (Sentry etc.), no alerts; 150+ places silently swallow errors.
- **No staging**: one Supabase project, so any preview hits real leads.
- **Publishing can double-post** (no lock/idempotency) and has no timeout on Meta calls ✔.
- **Schema not reproducible**: migration numbers collide (two 018, two 019) ✔; core tables made by hand.
- Background jobs depend on a single self-hosted n8n box.
- `.env.example` lists ~31 of ~80 settings; setup needs secrets from one SSD.
- Next.js 14 → current is 16; React 18 → 19; two AI SDKs installed but unused.

## 3. Legal & compliance (hard blockers for selling)

- **No Privacy Policy or Terms pages** ✔ — required by Meta, Google and LinkedIn app review, and by law.
- **Public lead form collects student name/phone/email with no notice or consent** ✔. Many are minors (Class 12). Under India's **DPDP Act 2023**, core obligations (notice, consent, children's data with parental consent, breach reporting, erasure) apply from **~13 May 2027**; consent-manager rules from Nov 2026.
- No data export, no per-person erasure for leads, no written retention or backup/restore plan.
- **Meta**: to publish for *other* businesses you need Business Verification → App Review for Advanced Access (e.g. `instagram_content_publish`) → Tech Provider access verification.
- **Google**: `gmail.send` and YouTube scopes need OAuth verification; restricted scopes add an annual paid CASA security assessment.
- Reselling Apify/DataForSEO/Perplexity data: check their terms; meter cost per customer.
- India commercial basics: GST invoices, Razorpay subscriptions, refund policy, DPA (data processing agreement) template for B2B clients.

## 4. Features a standard product has

| Missing | Notes | Effort |
|---|---|---|
| Sign-up → create workspace → connect channels wizard | Today: admin types a member in; Instagram via env vars; YouTube via a CLI script | L |
| Connect-your-own-account OAuth for Instagram/FB/LinkedIn/Google | Today one global token per provider | L |
| Billing, plans, trial, usage limits | None | L |
| One **Settings** area (Profile · Workspace · Members & roles · Integrations · Notifications · Billing) | Today scattered over Team, Account (not in sidebar), Integrations, Connectors, API keys | M |
| Named roles (Owner / Admin / Editor / Viewer) | Today per-section toggles + hard-coded people | M |
| Per-workspace timezone, currency, language | 414 `en-IN`, 135 ₹, 54 `Asia/Kolkata` literals | M–L |
| Replace Airtable + n8n dependencies | Customers won't have your Airtable base | L |
| Help centre / docs, in-app support chat, status page | Only dev docs exist | M |
| Data export (CSV) everywhere | Only geo report today | M |

GooCampus-only modules (Sales Hub admissions CRM, counsellors, KEA/MCC Watchers, e-Book orders, Attendance) should become optional "add-ons" or stay internal.

## 5. Looking like standard software

Already good: ⌘K search, keyboard shortcuts, dark mode, confirm dialogs (no `alert()` left), What's new, recycle bin/undo, tab intros, PWA.

To fix:
- **No error pages** — zero `error.tsx` / `not-found.tsx` ✔; crashes show Next's default screen.
- **Mobile**: sidebar is hidden under 980px with no menu to replace it ✔.
- **Navigation too dense**: ~70 entries; three "calendars", Integrations vs Connectors vs API keys, "Marketing Hub" used twice, 4 orphan pages.
- Spinners instead of skeleton loaders; empty states differ per tab and rarely suggest a next step.
- Design drift: ~4,500 hard-coded colours, 30 bold (700) weights, 118 dead shadow classes, 10 native selects.
- Accessibility: 258 clickable divs not reachable by keyboard; few aria labels/focus rings.
- ~13,000 lines of unreachable V1 pages still shipped; three files of ~5,000 lines each.
- Public site: `/welcome` landing page exists but isn't linked; no pricing page.

---

## Suggested roadmap

**Phase 0 — Hygiene (1–2 weeks, safe, helps today too)**
Privacy/Terms pages + consent on lead form · error pages · mobile menu · patch npm criticals · DOMPurify for articles · publish double-post guard · move SSD credential files to a password manager · CI (typecheck + all tests) · Sentry · complete `.env.example` · delete V1 pages.

**Phase 1 — Make it installable for a 2nd customer (4–8 weeks)**
Schema baseline + proper migrations · staging environment · roster/brands/accounts/owner rules out of code into the DB (Rules engine already started) · encrypt tokens · 2FA for admins · shared rate limiter · per-workspace timezone/currency · unified Settings · nav cleanup · Meta Business Verification + App Review, Google verification.

**Phase 2 — Real SaaS (2–4+ months)**
`org_id` + RLS on every table · sign-up & onboarding wizard · connect-your-own OAuth · billing (Razorpay) · replace Airtable/n8n with Supabase + a job queue · Next 16 / React 19 · e2e tests · audit log · DPDP processes (DPA, erasure, breach) · later SOC 2.

## Sources
- DPDP Rules timeline: [EY](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025), [Mondaq](https://www.mondaq.com/india/privacy-protection/1707558/digital-personal-data-protection-rules-2025-highlights), [SS Rana](https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/)
- Meta: [App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review), [Tech Provider verification (Zeta)](https://products.zetaglobal.com/selligent/EN/Content/Engage/Admin%20Configuration/Details/MetaTechProviderAccessVerificationProcess.htm)
- Google: [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Security assessment](https://support.google.com/cloud/answer/13465431?hl=en)
