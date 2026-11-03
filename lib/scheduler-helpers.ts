// Smart features for the Scheduler tab.
// Each function takes a "publishToPage" label (the brand option the UI uses)
// and resolves it to one of the configured IG accounts.

import { getAccount, getConfiguredAccounts, fetchAudience, fetchRecentMedia, fetchMediaInsights, type IGAccountConfig, type IGMedia } from "@/lib/instagram";
import { fetchPagePosts } from "@/lib/facebook";

// Inlined to survive the Mac-side rename of extractHashtags from the older lib
function extractHashtags(text: string | undefined | null): string[] {
  if (!text) return [];
  return (text.match(/#([\p{L}\p{N}_]+)/gu) || []).map((t) => t.slice(1).toLowerCase());
}

// Common English + Hinglish stopwords + filler GooCampus uses in every caption.
// Anything in here is NEVER counted as a topic signal.
const STOPWORDS = new Set([
  // articles, pronouns
  "the","a","an","is","are","was","were","be","been","being","of","in","on","at","to","for","with","by","from",
  "this","that","these","those","your","my","our","you","we","me","us","it","its","i","he","she","they","them",
  "their","theirs","his","her","hers","mine","ours","yours","whose","who","whom","whose","what","which",
  // helpers / modals
  "has","have","had","will","would","should","could","can","may","might","must","shall","do","does","did","done",
  "make","made","makes","take","took","taken","get","got","gets","getting","give","gave","given","go","goes","went","gone",
  "say","said","says","find","found","know","known","want","wants","need","needs","try","tried","use","used","using",
  // connectors / adverbs
  "but","and","or","if","so","as","also","even","still","yet","ever","never","often","always","sometimes","usually",
  "than","then","because","since","while","during","until","before","after","through","across","along","behind",
  "between","among","into","onto","upon","over","under","above","below","without","within",
  // quantifiers / time
  "all","any","some","every","each","no","not","none","only","just","very","more","less","most","least","much","many",
  "few","several","both","either","neither","here","there","now","today","tomorrow","yesterday","week","weeks",
  "month","months","year","years","day","days","time","times","again","once","twice",
  // common adjectives / fillers
  "one","two","three","four","five","first","second","last","next","best","good","great","new","old","right","wrong",
  "high","low","big","small","long","short","whole","real","true","false","sure","clear","important","actually",
  // GooCampus caption template fillers (recur in nearly every post)
  "comment","link","bio","via","ek","hi","ka","ki","ko","se","ke","par","aap","main",
  "com","www","https","http","follow","share","post","reel","video","watch","check","tap","click","read","see",
  "save","like","let","help","start","step","steps","tips","plan","guide","more","know","look","apply","join",
  "free","limited","spot","limited","today","tomorrow","spots","seats","spot","spots","program","programs",
  "people","everyone","someone","anyone","others","other","another","also","example","instead","details","info",
  "case","cases","note","fact","facts","reason","reasons","stage","stages","point","points","thing","things",
]);

// Pull "topic keyword" candidates from a caption — significant words 3+ chars that aren't common
// English filler. Used to match new captions to past ones even without #hashtag formatting.
// Returns lowercase set.
function extractTopicKeywords(text: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  // Strip URLs and punctuation, split into tokens
  const cleaned = text.replace(/https?:\/\/\S+/g, " ").toLowerCase();
  const tokens = cleaned.match(/[\p{L}\p{N}_]{3,}/gu) || [];
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;        // pure numbers
    out.add(t);
  }
  return out;
}

// Brand label (as used in the Scheduler form) -> primary IG account ID
const PAGE_TO_ACCOUNT_ID: Record<string, string> = {
  "GooCampus Main": "goocampus",
  "GooCampus World": "goocampusworld",
  "12Plus / GC India": "12thplusdotcom",
};

// A linked brand's page value is its Facebook page name, which is also the label of its
// connected account (lib/brand-accounts.ts; loaded by requireSection).
export function resolveAccountForPage(publishToPage: string): IGAccountConfig | null {
  const accId = PAGE_TO_ACCOUNT_ID[publishToPage];
  if (accId) return getAccount(accId);
  return getConfiguredAccounts().find((a) => a.pageId && a.label === publishToPage) ?? null;
}

// ------ Smart time suggestion ------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type TimeSuggestion = {
  weekday: number;      // 0=Mon ... 6=Sun
  hour: number;         // 0-23
  weekdayLabel: string;
  hourLabel: string;
  followersOnline: number;
  nextOccurrenceISO: string; // next future date+time matching this (weekday, hour)
};

function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

// Given a weekday (0=Mon, 6=Sun) and hour, return the ISO of the *next* future
// occurrence at that local-clock moment.
function nextOccurrence(targetWeekday: number, hour: number): string {
  const now = new Date();
  const todayJsDay = now.getDay();              // 0=Sun...6=Sat
  const todayMonFirst = todayJsDay === 0 ? 6 : todayJsDay - 1;
  let daysAhead = (targetWeekday - todayMonFirst + 7) % 7;
  const candidate = new Date(now);
  candidate.setDate(now.getDate() + daysAhead);
  candidate.setHours(hour, 0, 0, 0);
  if (candidate.getTime() <= now.getTime() + 60_000) {
    // Slot is today but already past (or within next minute) — push to next week
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.toISOString();
}

export async function getTopTimeSuggestions(publishToPage: string, count = 3): Promise<TimeSuggestion[]> {
  const acc = resolveAccountForPage(publishToPage);
  if (!acc) return [];
  const audience = await fetchAudience(acc);
  const grid = audience.onlineGrid; // (number|null)[7][24]   weekday × hour
  if (!grid || grid.length === 0) return [];

  // Flatten to {weekday, hour, value} cells
  const cells: { weekday: number; hour: number; value: number }[] = [];
  for (let w = 0; w < grid.length; w++) {
    const row = grid[w] || [];
    for (let h = 0; h < row.length; h++) {
      const v = row[h];
      if (typeof v === "number" && v > 0) cells.push({ weekday: w, hour: h, value: v });
    }
  }
  if (cells.length === 0) return [];

  const sorted = cells.sort((a, b) => b.value - a.value);
  return sorted.slice(0, count).map((c) => ({
    weekday: c.weekday,
    hour: c.hour,
    weekdayLabel: DAY_LABELS[c.weekday],
    hourLabel: hourLabel(c.hour),
    followersOnline: c.value,
    nextOccurrenceISO: nextOccurrence(c.weekday, c.hour),
  }));
}

// ------ Analytics prediction (similar posts) ------

export type Prediction = {
  // Which matching strategy actually ran
  basis: "topic-keyword" | "hashtag-overlap" | "recent-avg" | "no-data";
  matchedPosts: number;
  avgReach: number;
  avgEngagement: number;
  avgLikes: number;
  sampleSize: number;
  hashtagsMatched: string[];
  keywordsMatched: string[];
  note: string;
  // Hashtag coaching — null when account never uses hashtags
  hashtagLift: {
    withAvgReach: number;
    withoutAvgReach: number;
    liftPct: number;        // positive = hashtags help on this account
    sampleWith: number;
    sampleWithout: number;
  } | null;
  // Top hashtags this account has used historically (lowercase, no #)
  suggestedHashtags: string[];
  captionHasHashtags: boolean;
};

type PostWithStats = {
  id: string;
  caption: string;
  hashtags: string[];
  keywords: Set<string>;
  reach: number;
  engagement: number;
  likes: number;
};

async function getRecentPostsWithStats(acc: IGAccountConfig, limit = 50): Promise<PostWithStats[]> {
  const media = await fetchRecentMedia(acc, limit);
  const out: PostWithStats[] = [];

  // Cap concurrency
  const concurrency = 6;
  let idx = 0;
  async function worker() {
    while (idx < media.length) {
      const i = idx++;
      const m = media[i];
      let reach = 0, engagement = 0;
      try {
        const insights = await fetchMediaInsights(acc, m.id, m.media_type, m.media_product_type);
        for (const ins of insights) {
          const v = ins.values?.[0]?.value;
          if (typeof v !== "number") continue;
          if (ins.name === "reach") reach = v;
          else if (ins.name === "total_interactions") engagement = v;
        }
      } catch { /* ignore older posts that lack insights */ }
      out[i] = {
        id: m.id,
        caption: m.caption || "",
        hashtags: extractHashtags(m.caption),
        keywords: extractTopicKeywords(m.caption),
        reach,
        engagement: engagement || ((m.like_count ?? 0) + (m.comments_count ?? 0)),
        likes: m.like_count ?? 0,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, media.length) }, () => worker()));
  return out.filter(Boolean);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((s, n) => s + n, 0) / arr.length);
}

export async function predictForCaption(publishToPage: string, caption: string): Promise<Prediction | null> {
  const acc = resolveAccountForPage(publishToPage);
  if (!acc) return null;

  const targetTags = extractHashtags(caption);
  const targetKeywords = extractTopicKeywords(caption);
  const posts = await getRecentPostsWithStats(acc, 50);

  // Always compute: most-used hashtags on this account + with/without hashtag lift
  const allHashtagCounts = new Map<string, number>();
  for (const p of posts) for (const h of p.hashtags) allHashtagCounts.set(h, (allHashtagCounts.get(h) || 0) + 1);
  const suggestedHashtags = Array.from(allHashtagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([h]) => h);

  const postsWithHashtags = posts.filter((p) => p.hashtags.length > 0);
  const postsWithoutHashtags = posts.filter((p) => p.hashtags.length === 0);
  const hashtagLift = postsWithHashtags.length >= 2 && postsWithoutHashtags.length >= 2
    ? {
        withAvgReach: avg(postsWithHashtags.map((p) => p.reach)),
        withoutAvgReach: avg(postsWithoutHashtags.map((p) => p.reach)),
        liftPct: 0,
        sampleWith: postsWithHashtags.length,
        sampleWithout: postsWithoutHashtags.length,
      }
    : null;
  if (hashtagLift && hashtagLift.withoutAvgReach > 0) {
    hashtagLift.liftPct = Math.round(((hashtagLift.withAvgReach - hashtagLift.withoutAvgReach) / hashtagLift.withoutAvgReach) * 100);
  }

  const captionHasHashtags = targetTags.length > 0;

  if (posts.length === 0) {
    return {
      basis: "no-data", matchedPosts: 0, avgReach: 0, avgEngagement: 0, avgLikes: 0, sampleSize: 0,
      hashtagsMatched: [], keywordsMatched: [],
      note: "No past posts with insights yet on this account.",
      hashtagLift: null, suggestedHashtags, captionHasHashtags,
    };
  }

  // Strategy 1: hashtag overlap (most specific signal)
  const matchedTagSet = new Set<string>();
  let matched: PostWithStats[] = [];
  if (targetTags.length > 0) {
    matched = posts.filter((p) => {
      const overlap = p.hashtags.filter((t) => targetTags.includes(t));
      overlap.forEach((t) => matchedTagSet.add(t));
      return overlap.length > 0;
    });
  }

  // Strategy 2: topic-keyword overlap (looser, works without #hashtags — fits GooCampus's caption style).
  // Smarter version: rank matched keywords by RARITY across past posts, drop ones that appear in >60%
  // of posts (they're too common to be a signal — e.g. "doctor", "australia" if every post mentions them).
  let topicMatched: PostWithStats[] = [];
  const matchedKeywordCounts = new Map<string, number>();
  if (matched.length < 2 && targetKeywords.size > 0) {
    // Document frequency for every keyword in the corpus
    const docFreq = new Map<string, number>();
    for (const p of posts) for (const kw of p.keywords) docFreq.set(kw, (docFreq.get(kw) || 0) + 1);

    // Filter targetKeywords to "meaningful" ones: present in past posts, but not in too many (noise filter)
    const totalDocs = posts.length;
    const meaningfulTarget = new Set<string>();
    for (const kw of targetKeywords) {
      const df = docFreq.get(kw) || 0;
      if (df === 0) continue;                                    // never seen in past posts
      if (df / totalDocs > 0.6) continue;                        // too common — appears in 60%+ of posts
      if (kw.length < 3) continue;                                // too short
      meaningfulTarget.add(kw);
    }

    topicMatched = posts.filter((p) => {
      let hits = 0;
      for (const kw of meaningfulTarget) {
        if (p.keywords.has(kw)) {
          hits++;
          matchedKeywordCounts.set(kw, (matchedKeywordCounts.get(kw) || 0) + 1);
        }
      }
      return hits >= 2;
    });

    // For display: rank matched keywords by RARITY (low docFreq = high signal value)
    // and replace the count-based matchedKeywordCounts with an IDF-sorted ordering
    if (topicMatched.length > 0) {
      const rankedEntries = Array.from(matchedKeywordCounts.entries())
        .sort((a, b) => (docFreq.get(a[0]) || 99) - (docFreq.get(b[0]) || 99));
      matchedKeywordCounts.clear();
      for (const [k, v] of rankedEntries) matchedKeywordCounts.set(k, v);
    }
  }

  // Choose the best signal we have
  let basis: Prediction["basis"];
  let sample: PostWithStats[];
  let note: string;
  let keywordsMatched: string[] = [];

  if (matched.length >= 2) {
    basis = "hashtag-overlap";
    sample = matched;
    note = `Based on ${matched.length} past posts using the same hashtags (${Array.from(matchedTagSet).map((t) => "#" + t).slice(0, 4).join(" ")})`;
  } else if (topicMatched.length >= 2) {
    basis = "topic-keyword";
    sample = topicMatched;
    keywordsMatched = Array.from(matchedKeywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
    note = `Based on ${topicMatched.length} past posts about ${keywordsMatched.join(", ")}`;
  } else {
    basis = "recent-avg";
    sample = posts.slice(0, 10);
    note = `No strong topic or hashtag match. Showing average of last ${sample.length} posts on this account.`;
  }

  return {
    basis,
    matchedPosts: matched.length || topicMatched.length,
    avgReach: avg(sample.map((p) => p.reach)),
    avgEngagement: avg(sample.map((p) => p.engagement)),
    avgLikes: avg(sample.map((p) => p.likes)),
    sampleSize: sample.length,
    hashtagsMatched: Array.from(matchedTagSet).slice(0, 6),
    keywordsMatched,
    note,
    hashtagLift,
    suggestedHashtags,
    captionHasHashtags,
  };
}

// ------ Top performers ------

export type TopPerformer = {
  id: string;
  permalink: string;
  thumbnail: string | null;
  mediaType: string;
  caption: string;
  reach: number;
  likes: number;
  comments: number;
  timestamp: string;
};

export async function getTopPerformers(publishToPage: string, count = 5, daysBack = 90): Promise<TopPerformer[]> {
  const maybeAcc = resolveAccountForPage(publishToPage);
  if (!maybeAcc) return [];
  const acc: IGAccountConfig = maybeAcc;   // narrow to non-null for closures below
  const media = await fetchRecentMedia(acc, 75);
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const recent = media.filter((m: IGMedia) => new Date(m.timestamp).getTime() >= cutoff);

  // Fetch reach for each (parallel, capped)
  const concurrency = 6;
  let idx = 0;
  const enriched: (TopPerformer & { _reach: number })[] = [];
  async function worker() {
    while (idx < recent.length) {
      const i = idx++;
      const m = recent[i];
      let reach = 0;
      try {
        const insights = await fetchMediaInsights(acc, m.id, m.media_type, m.media_product_type);
        for (const ins of insights) {
          const v = ins.values?.[0]?.value;
          if (typeof v === "number" && ins.name === "reach") reach = v;
        }
      } catch { /* ignore */ }
      enriched[i] = {
        _reach: reach,
        id: m.id,
        permalink: m.permalink,
        thumbnail: m.thumbnail_url || m.media_url || null,
        mediaType: m.media_product_type === "REELS" ? "REEL" : m.media_type,
        caption: m.caption || "",
        reach,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        timestamp: m.timestamp,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, recent.length) }, () => worker()));

  return enriched
    .filter(Boolean)
    .sort((a, b) => b._reach - a._reach)
    .slice(0, count)
    .map(({ _reach, ...rest }) => { void _reach; return rest; });
}

// ---- Facebook: what the last posts actually did ------------------------------
//
// Nandu asked for "expected reach in facebook also" (23 Sep). Instagram's number
// can't simply be repeated here: Meta no longer serves post reach or impressions
// for Page posts at all (post_impressions, post_impressions_unique and post_reach
// are rejected on v19 through v23, on every one of our pages), so there is nothing
// to predict reach from and nothing to compare a caption against.
//
// What IS readable is what each post got: likes, comments and shares. So rather
// than invent a forecast, this reports the measured baseline and lets the page say
// so plainly — including when the honest answer is zero, which it currently is.
export type FacebookBaseline = {
  available: boolean;
  reason?: string;
  posts: number;          // how many recent posts this is based on
  likes: number;
  comments: number;
  shares: number;
  avgEngagement: number;  // per post, rounded
  best: { engagement: number; message: string } | null;
};

export async function facebookBaseline(publishToPage: string, limit = 25): Promise<FacebookBaseline> {
  const empty: FacebookBaseline = { available: false, posts: 0, likes: 0, comments: 0, shares: 0, avgEngagement: 0, best: null };
  const acc = resolveAccountForPage(publishToPage);
  if (!acc) return { ...empty, reason: "No Facebook page is linked to this brand." };
  const res = await fetchPagePosts(acc, limit);
  if (!res.available) return { ...empty, reason: res.reason };
  if (!res.items.length) return { ...empty, available: true, reason: undefined };

  let likes = 0, comments = 0, shares = 0;
  let best: FacebookBaseline["best"] = null;
  for (const post of res.items) {
    const l = post.likes ?? 0, c = post.comments ?? 0, sh = post.shares ?? 0;
    likes += l; comments += c; shares += sh;
    const eng = l + c + sh;
    if (eng > 0 && (!best || eng > best.engagement)) best = { engagement: eng, message: (post.message || "").slice(0, 120) };
  }
  const total = likes + comments + shares;
  return {
    available: true,
    posts: res.items.length,
    likes, comments, shares,
    avgEngagement: Math.round((total / res.items.length) * 10) / 10,
    best,
  };
}
