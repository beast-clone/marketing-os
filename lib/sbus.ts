// The SBU (brand / business unit) list, in one place.
//
// SBU is a required field on every task — the create gate in
// /api/marketing-hub/create rejects a row without one, because a brand-less row
// can't be routed, filtered or reported on by anybody. Three surfaces used to keep
// their own drifting copies of this list; they all read this now.
//
// Live facets from the hub API take precedence wherever they're available — this
// is the fallback, and the option list for surfaces that don't load facets.
export const SBU_OPTIONS = [
  "10K Mentorship", "12thPlus.com", "Allied Courses", "Australia-PGCP", "Buckingham Program", "Dr Divij's Course",
  "General Content", "India NEET PG Consulting", "India NEET UG Consulting", "Interview Plus", "ISIP",
  "Mentorship Platform", "Middle East", "Portfolio Plus", "Samvaya Matrimony", "Special Days", "SSAHE",
  "Standard Consulting Program - Australia", "Standard Consulting Program - UK", "Standard Consulting Program - USA",
  "Study Abroad", "UK ALS Course", "UK-PGCP", "University Programs",
] as const;

/** A brand that actually exists. Typing the list stops a fourth surface
 * inventing its own name (Content Radar filed stories under a "NEET PG" that was
 * not an SBU, so every brand dropdown on the board showed it twice — Manya, 23 Sep). */
export type Sbu = (typeof SBU_OPTIONS)[number];
