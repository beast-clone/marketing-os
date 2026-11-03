import { pageForSbu } from "@/lib/sbu-pages";
import { pageInfo } from "@/lib/publish-pages";
import { VIDEO_TYPES } from "@/lib/mh-content-types";

// Matching a Content Calendar task to the post that actually went live.
//
// Why this exists: the dashboard already has a write-back seam (lib/mh-linkback)
// that fills a task's Instagram / Facebook / LinkedIn link the moment IT publishes
// something. The team publishes from the apps instead, so that seam has never
// fired — on 27 Sep 2026 all 41 published tasks had no link at all. This works the
// other way round: take the posts that are genuinely live (the same /api/posts feed
// the Publishing Calendar draws) and work out which task each one belongs to.
//
// The rule is deliberately cautious. A wrong link is worse than a blank one: it
// looks right, so nobody checks it. Everything here is built so the caller can tell
// "this is certainly the post" apart from "one of these is the post" — see
// `confident` on the result.

/** Brand (SBU) → the Instagram account it goes out on. null = not one of ours. */
export function accountIdForSbu(sbu: string | null | undefined): string | null {
  // The page's account — a GooCampus page or a linked brand (lib/publish-pages.ts);
  // null for an SBU we don't post for.
  const page = pageForSbu(sbu);
  return page ? pageInfo(page).accountId || null : null;
}

// Words that appear in almost every caption and so tell us nothing about WHICH post
// this is. Leaving them in lets two unrelated posts score as similar.
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these",
  "those", "you", "your", "we", "our", "us", "at", "by", "from", "as", "not", "can",
  "will", "what", "how", "why", "who", "when", "where", "all", "more", "most", "do",
  "does", "did", "have", "has", "had", "post", "link", "bio",
]);

function tokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")   // urls are noise, and every caption has one
      .replace(/#\w+/g, " ")             // so are hashtags — they repeat across posts
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Overlap of the smaller set — 0…1. Deliberately not Jaccard: a task title is much
 *  shorter than a caption, and Jaccard would punish it for that. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / Math.min(a.size, b.size);
}

export type MatchTask = {
  particulars: string | null;
  caption: string | null;
  publishing_date: string | null;
  /** The Content Calendar type. Used only to rule a match OUT — see formatClash. */
  type?: string | null;
};

// A reel is not a carousel. Instagram and Facebook both say which a post is in its
// permalink (/reel/ vs /p/ or /posts/), and the task says what was commissioned, so a
// disagreement is real evidence the two are different things.
//
// It is used to veto, never to confirm: a task can legitimately be filed as a carousel
// and go out as a reel, so this does not prove a match is wrong — it proves it is not
// CERTAIN, which is enough to hand the decision to a person instead of writing it in
// unattended. Found on "Career Quiz - Carousel", which matched a reel on caption alone.
export function formatClash(taskType: string | null | undefined, url: string): boolean {
  if (!taskType) return false;
  const postIsVideo = /\/reel(s)?\//i.test(url);
  const postIsStatic = /\/p\/|\/posts\//i.test(url);
  if (!postIsVideo && !postIsStatic) return false;   // LinkedIn, or a shape we don't read
  const taskIsVideo = VIDEO_TYPES.has(taskType);
  return taskIsVideo ? postIsStatic : postIsVideo;
}
export type MatchPost = {
  id: string;
  caption?: string | null;
  permalink?: string | null;
  timestamp?: string | null;
};
export type Candidate = { id: string; url: string; caption: string; timestamp: string | null; score: number; formatClash?: boolean };

const DAY = 24 * 60 * 60 * 1000;

// How far either side of the publishing date to look. A post can slip a day or go out
// early; beyond this the text match is doing all the work anyway and the extra posts
// only add things to be confused with. Shared so the modal and the nightly job search
// the same span — a link the job would not make should not appear on a button either.
export const WINDOW_DAYS = 3;

export function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Rank the live posts against one task.
 *
 * Score is the text overlap, nudged by how close the post is to the day the task was
 * meant to publish. Text does the work: several posts go out on the same day for the
 * same brand (the Publishing Calendar shows 3–8), so the date alone can never decide.
 */
export function rankPosts(task: MatchTask, posts: MatchPost[]): Candidate[] {
  // The task's own caption is the strongest signal — it is usually the text that was
  // pasted into Instagram. When it is empty (35 of 41 tasks), fall back to the title,
  // which at least describes the same subject.
  const taskText = (task.caption || "").trim() || (task.particulars || "");
  const tt = tokens(taskText);
  const due = task.publishing_date ? new Date(task.publishing_date + "T00:00:00").getTime() : null;

  return posts
    .filter((p) => p.permalink)
    .map((p) => {
      let score = overlap(tt, tokens(p.caption || ""));
      if (due && p.timestamp) {
        const days = Math.abs(new Date(p.timestamp).getTime() - due) / DAY;
        // Same day is what we expect; a day either side still plausible; beyond that
        // the text has to carry it entirely.
        if (days <= 1) score += 0.1;
        else if (days > 3) score -= 0.1;
      }
      return {
        id: p.id,
        url: p.permalink as string,
        caption: (p.caption || "").split("\n")[0].slice(0, 120),
        timestamp: p.timestamp || null,
        score: Math.max(0, Math.min(1, score)),
        formatClash: formatClash(task.type, p.permalink as string),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// What counts as "certain". Both have to hold: the winner must actually look like the
// task, AND it must be clearly ahead of whatever came second — otherwise two similar
// posts on a theme (this brand runs series) would let a coin toss decide.
const SURE_SCORE = 0.55;
const SURE_LEAD = 0.18;

export type MatchResult = { confident: Candidate | null; candidates: Candidate[] };

export function matchPost(task: MatchTask, posts: MatchPost[]): MatchResult {
  const ranked = rankPosts(task, posts);
  if (ranked.length === 0) return { confident: null, candidates: [] };

  // Only one post from this brand in the whole window — there is nothing it could be
  // confused with, so a weaker text match is still safe.
  if (ranked.length === 1) {
    return ranked[0].score >= 0.25 && !ranked[0].formatClash
      ? { confident: ranked[0], candidates: ranked }
      : { confident: null, candidates: ranked };
  }

  const [best, second] = ranked;
  const sure = best.score >= SURE_SCORE && best.score - second.score >= SURE_LEAD && !best.formatClash;
  return { confident: sure ? best : null, candidates: ranked.slice(0, 8) };
}
