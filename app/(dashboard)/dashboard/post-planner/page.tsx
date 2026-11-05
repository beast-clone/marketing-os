"use client";
import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";

type Planned = {
  id: string; title: string; type: string; interest: string;
  thumbnailUrl: string | null; status: string; suggestedTime: string; reason: string; tags: string[];
};
type Payload = {
  account: string; minGapHours: number;
  last: { title: string; type: string; interest: string; at: string | null } | null;
  summary: string; insight: string;
  plan: Planned[];
  hold: { id: string; title: string; reason: string }[];
  bestHours: number[];
  generatedAt: string;
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

function typeChip(t: string) {
  const s = (t || "").toLowerCase();
  if (s.includes("reel")) return { bg: "#FFEAF1", fg: "#B23A6A", label: "Reel" };
  if (s.includes("carousel")) return { bg: "#F0ECFF", fg: "#5142C4", label: "Carousel" };
  return { bg: "#E6F1FF", fg: "#2B6AB0", label: t || "Post" };
}

export default function PostPlannerPage() {
  return (
    <DashboardShell
      title="Post Planner"
      subtitle="AI-suggested publishing order so your posts lift each other instead of competing."
      hideAccountPicker
    >
      {() => <Planner />}
    </DashboardShell>
  );
}

function Planner() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/post-planner${force ? "?force=1" : ""}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d as Payload);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-[900px]">
      {/* Scope banner */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-brand text-white">@12thplus.com</span>
        <span className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-gray-100 text-gray-700">24-hour minimum gap</span>
        <div className="ml-auto flex items-center gap-2">
          {data && <span className="text-[11px] text-gray-400">Updated {new Date(data.generatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>}
          <button onClick={() => load(true)} disabled={loading} className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:border-brand text-gray-700 disabled:opacity-50">
            {loading ? "Thinking…" : "↻ Re-plan"}
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-100 rounded-2xl" />
          {[0, 1, 2].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl" />)}
        </div>
      )}

      {err && !data && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800">Couldn&rsquo;t build the plan — {err}</div>
      )}

      {data && (
        <>
          {/* Summary + what-works */}
          <div className="bg-brand/5 border border-brand/20 rounded-2xl p-4 mb-5">
            <p className="text-[14px] text-gray-800 leading-relaxed">{data.summary}</p>
            {data.insight && (
              <p className="text-[12.5px] text-gray-600 mt-2 leading-relaxed"><b className="text-brand">What works here:</b> {data.insight}</p>
            )}
          </div>

          {/* Last published anchor */}
          {data.last && (
            <div className="flex items-center gap-3 mb-4 text-[12.5px] text-gray-500">
              <span className="text-[10.5px] uppercase tracking-widest font-semibold text-gray-400">Last posted</span>
              <span className="font-medium text-gray-800">{data.last.title || "(untitled)"}</span>
              <span className="text-gray-400">· {data.last.type || "post"} · {fmtDate(data.last.at)}</span>
            </div>
          )}

          {/* The plan — a vertical timeline */}
          {data.plan.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-sm text-gray-500 shadow-sm">
              Nothing queued for 12thplus right now. Add posts in the Scheduler and hit <b>Re-plan</b>.
            </div>
          ) : (
            <ol className="relative space-y-3">
              {data.plan.map((p, i) => {
                const chip = typeChip(p.type);
                return (
                  <li key={p.id} className="relative bg-white border border-gray-100 rounded-2xl shadow-sm p-4 flex gap-4">
                    {/* order number */}
                    <div className="flex flex-col items-center pt-0.5">
                      <span className="w-7 h-7 rounded-full bg-brand text-white text-[13px] font-semibold flex items-center justify-center tabular-nums">{i + 1}</span>
                      {i < data.plan.length - 1 && <span className="flex-1 w-px bg-gray-200 mt-1" />}
                    </div>
                    {/* thumb */}
                    <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                      {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">▢</div>}
                    </div>
                    {/* body */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: chip.bg, color: chip.fg }}>{chip.label}</span>
                        {p.interest && <span className="text-[11px] text-gray-400">{p.interest}</span>}
                      </div>
                      <div className="text-[14px] font-semibold text-gray-900 leading-snug mt-1">{p.title || "(untitled)"}</div>
                      {p.reason && <div className="text-[12.5px] text-gray-600 mt-1 leading-snug">{p.reason}</div>}
                      {p.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {p.tags.map((t) => <span key={t} className="text-[10.5px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t}</span>)}
                        </div>
                      )}
                    </div>
                    {/* when */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10.5px] uppercase tracking-widest text-gray-400 font-semibold">Publish</div>
                      <div className="text-[13px] font-semibold text-gray-900 tabular-nums mt-0.5 whitespace-nowrap">{fmtWhen(p.suggestedTime)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Hold for later */}
          {data.hold.length > 0 && (
            <div className="mt-6">
              <div className="text-[10.5px] uppercase tracking-widest text-amber-600 font-semibold mb-2">⏸ Hold for later — would clash if posted next</div>
              <div className="space-y-2">
                {data.hold.map((h) => (
                  <div key={h.id} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="text-[13px] font-medium text-amber-900">{h.title || "(untitled)"}</div>
                    <div className="text-[12px] text-amber-800 mt-0.5">{h.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-gray-400 mt-6 leading-relaxed">
            Suggestions only — nothing is scheduled automatically. Times are snapped to when your 12thplus audience is most active, always ≥24h apart. Open the <b>Scheduler</b> to set any of these live.
          </div>
        </>
      )}
    </div>
  );
}
