import { cachedShared } from "@/lib/api-cache";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// What people are saying about us on Google Maps.
//
// The Radar's "Google Reviews" tile sat dim and said "not connected" for months, and the
// assumption was that connecting it needed a Google Places API key and a billing account.
// It doesn't: Serper (already keyed, already paying for the Reddit/Quora lanes) returns
// both the business card and the review text, so this needed no new credential at all.
//
// Two reasons reviews belong on a Content Radar, and they pull in opposite directions:
//   - A bad review is reputation damage that is costing money while nobody answers it.
//     Those are urgent and there are few of them.
//   - A good review is a testimonial you could post. There are hundreds and they are
//     interchangeable, so showing them all would bury everything else on the page.
// That asymmetry is why the two are ranked and labelled differently below rather than
// poured into one list of "reviews".

const SERPER_PLACES = "https://google.serper.dev/places";
const SERPER_REVIEWS = "https://google.serper.dev/reviews";

// The business almost never changes; the reviews do. Resolving the place costs a Serper
// credit and returns the same row every time, so it is cached far longer than the reviews.
const PLACE_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
const REVIEWS_TTL_MS = 60 * 60 * 1000;           // 1 hour, matching the Radar's own refresh

// Who we are on Google Maps. Overridable, because a second branch or a renamed listing
// should be a config change rather than a code change.
const BUSINESS_QUERY = process.env.GOOGLE_BUSINESS_QUERY || "GooCampus Edu Solutions Bengaluru";

export type GooglePlace = {
  title: string;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
  cid: string | null;
  website: string | null;
};

export type GoogleReview = {
  id: string;
  rating: number;
  /** ISO date. Google gives "5 months ago"; Serper resolves it, but not always. */
  publishedAt: string | null;
  /** Google's own words, e.g. "5 months ago" — kept for when the ISO date is missing. */
  relative: string | null;
  text: string;
  author: string;
  authorPhoto: string | null;
  link: string | null;
};

export type ReviewsResult = {
  place: GooglePlace | null;
  reviews: GoogleReview[];
  /** Null when the key is missing — the caller says "not connected" rather than "none". */
  configured: boolean;
  error: string | null;
};

function key(): string | null {
  return process.env.SERPER_API_KEY || null;
}

async function serper(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const k = key();
  if (!k) throw new Error("SERPER_API_KEY is not set");
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "X-API-KEY": k, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Serper ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

/** Find our listing on Google Maps. Cached for a month — it is the same row every time. */
export async function findPlace(force = false, query: string = BUSINESS_QUERY): Promise<GooglePlace | null> {
  const { data } = await cachedShared<GooglePlace | null>(
    `gmaps:place:${query}`,
    PLACE_TTL_MS,
    async () => {
      const d = await serper(SERPER_PLACES, { q: query, gl: "in" });
      const first = (d.places as Record<string, unknown>[] | undefined)?.[0];
      if (!first) return null;
      return {
        title: String(first.title || query),
        address: (first.address as string) || null,
        rating: typeof first.rating === "number" ? first.rating : null,
        ratingCount: typeof first.ratingCount === "number" ? first.ratingCount : null,
        cid: first.cid ? String(first.cid) : null,
        website: (first.website as string) || null,
      };
    },
    { force },
  );
  return data;
}

type RawReview = {
  rating?: number; isoDate?: string; date?: string; snippet?: string; id?: string; link?: string;
  user?: { name?: string; thumbnail?: string };
};

function mapReview(r: RawReview, i: number): GoogleReview {
  return {
    id: r.id || `${r.user?.name || "anon"}-${r.isoDate || r.date || i}`,
    rating: typeof r.rating === "number" ? r.rating : 0,
    publishedAt: r.isoDate || null,
    relative: r.date || null,
    text: (r.snippet || "").trim(),
    author: r.user?.name || "A Google user",
    authorPhoto: r.user?.thumbnail || null,
    link: r.link || null,
  };
}

/**
 * The newest reviews, plus the worst ones.
 *
 * Two passes on purpose. Sorted by date alone, a one-star review from three months ago —
 * still the first thing a prospective student reads, still unanswered — never appears,
 * because eighty five-star reviews have landed on top of it since. The lowest-rating pass
 * is what makes an old complaint findable at all.
 */
// `query` defaults to our own business; a competitor profile passes their name.
export async function getReviews(force = false, query: string = BUSINESS_QUERY): Promise<ReviewsResult> {
  if (!key()) {
    return { place: null, reviews: [], configured: false, error: null };
  }
  try {
    const place = await findPlace(force, query);
    if (!place?.cid) {
      return { place, reviews: [], configured: true, error: "Couldn't find the business on Google Maps" };
    }

    const { data } = await cachedShared<GoogleReview[]>(
      `gmaps:reviews:${place.cid}`,
      REVIEWS_TTL_MS,
      async () => {
        const [newest, worst] = await Promise.all([
          serper(SERPER_REVIEWS, { cid: place.cid, gl: "in", sortBy: "newest" }),
          serper(SERPER_REVIEWS, { cid: place.cid, gl: "in", sortBy: "lowestRating" }),
        ]);
        const all = [
          ...((newest.reviews as RawReview[] | undefined) || []),
          ...((worst.reviews as RawReview[] | undefined) || []),
        ].map(mapReview);

        // The same review appears in both passes whenever the newest one is also the
        // worst, which is exactly the case that matters most.
        const seen = new Set<string>();
        return all.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      },
      { force },
    );

    return { place, reviews: data, configured: true, error: null };
  } catch (e) {
    return { place: null, reviews: [], configured: true, error: (e as Error).message };
  }
}

/** Three stars or fewer is a complaint, whatever else it says. */
export const isNegativeReview = (r: GoogleReview) => r.rating > 0 && r.rating <= 3;
