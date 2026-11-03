"use client";
import { useEffect, useState } from "react";
import { AutoTextarea } from "@/components/AutoTextarea";
import { useDraft } from "@/lib/use-draft";
import { IconX } from "@tabler/icons-react";
import { CONTENT_TYPES, VIDEO_TYPES as VIDEO_TYPE_SET } from "@/lib/mh-content-types";
import { SBU_OPTIONS } from "@/lib/sbus";
import { firstWithRole, isEditor, keysWithRole } from "@/lib/team-roles";
import { useSbus } from "@/lib/use-sbus";
import MissingFieldsModal from "@/app/(dashboard)/dashboard/preview/MissingFieldsModal";
import {
  Avatar, DatePicker, MenuDropdown, PendingAssets, PPL, EMPTY_ASSET, usePplTeam,
  type PendingAsset, type NewTaskAssets,
} from "./parts";

// THE create-task form for the whole dashboard. It began life inside My Day and
// now lives here so every screen that creates a task uses this one — My Day's
// right-hand panel, and (through NewTaskDialog) the Marketing Hub + Content
// Calendar. One form means the field list, the required-field rules and the
// routing preview cannot drift apart between screens, which is exactly how the
// type list drifted before it was shared.
//
// The form owns what a task IS; it does not own what happens after. It hands the
// host a NewTaskDraft and the host decides where to put it, so My Day can keep
// its optimistic insert and the calendar can just POST and refresh.

const CC_TYPES: readonly string[] = [...CONTENT_TYPES];

// Only these three get asked "does this also need a thumbnail?". Shorts, story videos
// and Meta video ads don't get a separate thumbnail, so asking would be noise.
// docs/THUMBNAIL_FLOW_SPEC.md.
const THUMBNAIL_ELIGIBLE = new Set(["Reel - Original", "Reel - Cut", "YouTube Long-Form"]);
const thumbnailTypeFor = (videoType: string) =>
  /youtube/i.test(videoType) ? "YouTube Thumbnail" : "Reel Thumbnail";

// Who makes the thumbnail. "editor" and "ask" both leave it unowned until the video is
// claimed — the difference is whether the claiming editor gets a say.
export type ThumbnailWho = "editor" | "praveen" | "ask";
const THUMB_WHO: { value: ThumbnailWho; label: string; sub: string }[] = [
  { value: "editor",  label: "Whoever edits the video", sub: "The editor who claims it makes the thumbnail too. Nobody is asked." },
  { value: "ask",     label: "Let them decide",         sub: "The editor who claims it chooses: themselves, or the designer." },
  { value: "praveen", label: "The designer",            sub: "Goes straight to the designer now, without waiting for the video to be claimed." },
];

export type NewTaskThumbnail = {
  type: string;          // Reel Thumbnail | YouTube Thumbnail — follows the video
  title: string;
  content: string;
  who: ThumbnailWho;
};
const isVideoType = (t: string) => VIDEO_TYPE_SET.has(t);
const CC_SBUS = SBU_OPTIONS;

// The three statuses a task can be CREATED at. The rest of the pipeline is reached
// by moving the task on, not by filing it there on day one. Their labels are the
// status names themselves, so the dropdown needs no separate label map.
export type NewTaskStatus = "Content - Pending" | "Content - In Progress" | "Content - Approved";
const NEW_TASK_STATUSES: NewTaskStatus[] = ["Content - Pending", "Content - In Progress", "Content - Approved"];

export type NewTaskRoute = {
  ownerKey: string | null; ownerLabel: string; pool: boolean;
  collaborators: string[]; headline: string; why: string;
};

// What the form produces. Deliberately not My Day's `Task`: this is just the
// answers, and each host turns them into whatever it needs.
export type NewTaskDraft = {
  title: string; type: string; sbu: string;
  priority: "Urgent" | "High" | "Medium" | "Low";
  status: NewTaskStatus;
  content: string; publishDate: string;
  collaborators: string[];
  assets: NewTaskAssets;
  route: NewTaskRoute;
  /** Set only when the writer ticked "this also needs a thumbnail". */
  thumbnail?: NewTaskThumbnail;
};

/**
 * Where a task lands the moment it is saved, worked out from Type + Status with the
 * SAME rule the server uses — api/marketing-hub/update's Content-Approved handoff and
 * the mh_design_owner DB trigger (sql/013_design_work_owner.sql):
 *   · below Content - Approved → nobody is assigned yet; it sits with the writer.
 *   · Content - Approved + design type → owner becomes Praveen, the writer joins as collaborator.
 *   · Content - Approved + video type → owner STAYS with the writer; Nikhil/Nandu claim it from the pool.
 * Maheen is never auto-added by either side.
 * This function only DESCRIBES that rule so the creator can check the routing before
 * saving — it does not decide anything. The server still does the assigning.
 */
// `status` is a plain string, not NewTaskStatus: the board also asks this for tasks
// already past the create stage, and the only thing the rule looks at is whether the
// status is exactly "Content - Approved".
export function routeFor(type: string, status: string, writer: string): NewTaskRoute {
  const video = isVideoType(type);
  const approved = status === "Content - Approved";
  if (!approved) {
    return {
      ownerKey: writer, ownerLabel: PPL[writer]?.name || writer, pool: false, collaborators: [],
      headline: `Starts with ${PPL[writer]?.name || writer}; assigns on approval.`,
      why: `Nothing is handed over below Content - Approved — ${PPL[writer]?.name || writer} keeps it while the content is written.`,
    };
  }
  // Roles from the Team page (lib/team-roles.ts) — not names.
  const designer = firstWithRole("designer") || "praveen";
  const designerName = PPL[designer]?.name || designer;
  const editorNames = keysWithRole("editor").map((k) => PPL[k]?.name || k).join(" / ") || "an editor";
  if (video && isEditor(writer)) {
    // An editor filing a video into the pool lets go of it (save.ts releaseToPoolIfEditor),
    // otherwise it would stay theirs and never appear in the pool.
    return {
      ownerKey: "", ownerLabel: "Nobody — in the claim pool", pool: true, collaborators: [],
      headline: `Editors' claim pool — ${editorNames} claim it.`,
      why: `${type} is video work, so it goes into the shared pool with no owner until ${editorNames.replace(" / ", " or ")} claims it.`,
    };
  }
  if (video) {
    return {
      ownerKey: writer, ownerLabel: `${PPL[writer]?.name || writer} — until an editor claims it`, pool: true, collaborators: [],
      headline: `Editors' claim pool — ${editorNames} claim it.`,
      why: `${type} is video work, so it is never auto-assigned: it goes into the shared pool and stays with ${PPL[writer]?.name || writer} until ${editorNames.replace(" / ", " or ")} claims it.`,
    };
  }
  // Name the writer rather than calling them "the writer" — the person reading this is
  // checking a routing decision, and a role is one more step to translate.
  const writerName = PPL[writer]?.name || writer;
  const selfOwned = writer === designer; // the designer filing their own design work: no collaborator to name
  return {
    ownerKey: designer, ownerLabel: designerName, pool: false, collaborators: selfOwned ? [] : [writer],
    headline: selfOwned ? `Owner: ${designerName}.` : `Owner: ${designerName} · Collaborator: ${writerName}.`,
    why: `${type} is design work, so on approval it is handed straight to ${designerName}${selfOwned ? "." : ` and ${writerName} stays on as collaborator.`}`,
  };
}

/**
 * The create form. Lives INSIDE the right-hand detail panel (it used to be a centred
 * modal): the panel is empty until you ask for either a task or a new one, so the
 * form gets the full width of the panel and the task list stays readable beside it.
 */
export function NewTaskForm({ writer, initial, onClose, onCreate, onDirty }: {
  writer: string;
  onClose: () => void;
  initial?: { publishDate?: string; sbu?: string };
  onCreate: (draft: NewTaskDraft) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  usePplTeam();   // collaborator picker lists Team-page newcomers too
  const sbus = useSbus();   // live brand list (sql/027)
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("Reel Thumbnail");
  const [sbu, setSbu] = useState<string>(initial?.sbu || CC_SBUS[0]);
  const [priority, setPriority] = useState<"Urgent" | "High" | "Medium" | "Low">("Medium");
  const [status, setStatus] = useState<NewTaskStatus>("Content - Pending");
  const [content, setContent] = useState("");
  // A half-written task survives a closed tab (22 Oct).
  const titleDraft = useDraft(`newtask-title:${writer}`, title, setTitle);
  const contentDraft = useDraft(`newtask-content:${writer}`, content, setContent);
  // Pre-filled when the host already knows the date — the Content Calendar's "+" on
  // a day means the writer has picked it by clicking there. Everywhere else it starts
  // empty: the writer sets it, there is no auto-date.
  const [publishDate, setPublishDate] = useState(initial?.publishDate || "");
  const [refs, setRefs] = useState<PendingAsset>(EMPTY_ASSET);       // input references (many links + images)
  const [output, setOutput] = useState<PendingAsset>(EMPTY_ASSET);   // finished creative if the writer does it herself
  const [att, setAtt] = useState<PendingAsset>(EMPTY_ASSET);         // working files, never published
  // People added by hand, on top of whoever the routing rule attaches.
  // "Does this also need a thumbnail?" — only offered for the eligible video types.
  const [wantsThumb, setWantsThumb] = useState(false);
  const [thumbTitle, setThumbTitle] = useState("");
  const [thumbContent, setThumbContent] = useState("");
  const [thumbWho, setThumbWho] = useState<ThumbnailWho>("ask");
  const [extraCollabs, setExtraCollabs] = useState<string[]>([]);
  const [addingCollab, setAddingCollab] = useState(false);
  const writerName = PPL[writer]?.name || writer;

  const route = routeFor(type, status, writer);
  // Everyone on the task once it saves: the rule's collaborators + the hand-picked
  // ones, minus whoever ends up owning it (nobody is both owner and collaborator).
  const collabKeys = Array.from(new Set([...route.collaborators, ...extraCollabs])).filter((k) => k !== route.ownerKey);
  const notOnIt = Object.keys(PPL).filter((k) => k !== route.ownerKey && !collabKeys.includes(k) && !(route.pool && isEditor(k)));
  const addable = Object.keys(PPL).filter((k) => k !== route.ownerKey && !collabKeys.includes(k));

  // What's still missing, in the order the fields appear in the form. Drives both the
  // button state and the popup — a disabled "Create task" now explains itself.
  // The tick only exists for eligible types, so switching away from one has to clear
  // it — otherwise a Carousel could be saved carrying a reel thumbnail.
  const canHaveThumb = THUMBNAIL_ELIGIBLE.has(type);
  useEffect(() => { if (!canHaveThumb) setWantsThumb(false); }, [canHaveThumb]);
  const thumbType = thumbnailTypeFor(type);
  // Left blank, the thumbnail is named after the video — which is what it is.
  const thumbTitleFinal = thumbTitle.trim() || (title.trim() ? `${title.trim()} — Thumbnail` : "");
  const thumbOn = canHaveThumb && wantsThumb;

  // Only the title is needed to create a task — "I want the task to be created first
  // and then to add the content, remove extra barriers" (Manya, 12 Oct). The date and
  // the content are only demanded when filing straight at Content - Approved, because
  // the server won't approve without them. (It no longer needs a collaborator.)
  const approving = status === "Content - Approved";
  const missing = [
    !title.trim() && "Particulars (the title)",
    !sbu && "Primary interest (what it's for)",
    approving && !publishDate && "Publishing date (needed to approve)",
    approving && !content.trim() && "Content (needed to approve)",
    thumbOn && !thumbContent.trim() && "Thumbnail brief",
  ].filter((x): x is string => !!x);
  const canSubmit = missing.length === 0;
  const [gate, setGate] = useState(false);
  // Tell the panel whether there is anything worth warning about before discarding.
  const dirty = !!(title.trim() || content.trim() || publishDate || refs.links.length || refs.files.length || output.links.length || output.files.length || att.files.length || extraCollabs.length || wantsThumb);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  function create() {
    if (!canSubmit) { setGate(true); return; }
    // Content-first: whatever status is chosen here, the task is always SAVED at
    // "Content - Pending" on the writer, and the host moves it on afterwards through
    // the same status route the board uses — so the Content-Approved handoff fires
    // exactly as this form's routing preview promised, and only once.
    titleDraft.clear(); contentDraft.clear();
    onCreate({
      title: title.trim(),
      type, sbu, priority, status,
      content: content.trim(),
      publishDate,
      collaborators: collabKeys,
      assets: {
        refLinks: refs.links,
        refFiles: refs.files.map((f) => f.file),
        outLink: output.links[0] || "",
        outFiles: output.files.map((f) => f.file),
        attFiles: att.files.map((f) => f.file),
      },
      route,
      thumbnail: thumbOn
        ? { type: thumbType, title: thumbTitleFinal, content: thumbContent.trim(), who: thumbWho }
        : undefined,
    });
  }
  return (
    <>
      <div className="nt-head">
        <div>
          <div className="lbl" style={{ marginBottom: ".35rem" }}>New task · created by {writerName}</div>
          <div className="d-title">Create a content task</div>
        </div>
        <button className="nt-x" onClick={onClose} title="Close without creating"><IconX size={14} stroke={2} /></button>
      </div>
      <div className="nt-field"><label className="nt-label">Particulars <span className="nt-req">required</span></label><input className="nt-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. AMC Exam Guide — Thumbnail" />
        {(titleDraft.restored || contentDraft.restored) && <div className="nt-hint" style={{ display: "block", marginTop: 4 }}>Restored your unsaved draft · <button type="button" style={{ border: "none", background: "none", color: "#3A57E8", cursor: "pointer", padding: 0, font: "inherit" }} onClick={() => { titleDraft.discard(); contentDraft.discard(); }}>Discard</button></div>}</div>
      <div className="nt-row">
        <div className="nt-field"><label className="nt-label">Type</label><MenuDropdown wide align="left" value={type} onChange={setType} options={CC_TYPES.map((t) => ({ value: t, label: t }))} /></div>
        <div className="nt-field"><label className="nt-label">Priority</label><MenuDropdown wide align="left" value={priority} onChange={(v) => setPriority(v as "Urgent" | "High" | "Medium" | "Low")} options={["Urgent", "High", "Medium", "Low"].map((p) => ({ value: p, label: p }))} /></div>
      </div>
      <div className="nt-field"><label className="nt-label">Publishing date <span className="nt-hint">optional — add it now or later</span></label><DatePicker value={publishDate} onChange={setPublishDate} /></div>
      <div className="nt-row">
        <div className="nt-field"><label className="nt-label">Primary interest</label><MenuDropdown wide align="left" value={sbu} onChange={setSbu} options={sbus.map((s) => ({ value: s, label: s }))} /></div>
        <div className="nt-field"><label className="nt-label">Status</label><MenuDropdown wide align="left" value={status} onChange={(v) => setStatus(v as NewTaskStatus)} options={NEW_TASK_STATUSES.map((s) => ({ value: s, label: s }))} /></div>
      </div>

      {/* Live routing — recomputes on every Type / Status change so the creator can see
          where the task actually lands BEFORE saving it. */}
      <div className="nt-route">
        <div className="nt-route-head">
          <span className={`nt-route-dot ${route.pool ? "pool" : status === "Content - Approved" ? "on" : "wait"}`} />
          <span className="nt-route-headline">{route.headline}</span>
        </div>
        <div className="nt-route-grid">
          <div>
            <div className="mlbl">Owner</div>
            <div className="collab-cell">
              {route.ownerKey ? <><Avatar p={PPL[route.ownerKey]} /><span className="collab-names">{route.ownerLabel}</span></> : <span className="collab-names">{route.ownerLabel || "Unassigned"}</span>}
            </div>
          </div>
          <div>
            <div className="mlbl">Collaborators</div>
            <div className="collab-cell" style={{ position: "relative" }}>
              {collabKeys.length ? collabKeys.map((k) => {
                // Rule-attached people (the writer on design work) are added by the
                // server's own handoff — the form can't take them off, so the chip says
                // "auto" instead of offering a × that wouldn't hold.
                const auto = route.collaborators.includes(k);
                return (
                  <span key={k} className="collab-chip">
                    <Avatar p={PPL[k]} />
                    <span className="collab-names">{PPL[k].name}</span>
                    {auto
                      ? <span className="collab-auto" title="Added automatically on approval">auto</span>
                      : <button type="button" className="collab-del" title={`Remove ${PPL[k].name}`} onClick={() => setExtraCollabs((xs) => xs.filter((x) => x !== k))}>×</button>}
                  </span>
                );
              }) : <span className="collab-names" style={{ color: "var(--faint)" }}>None yet</span>}
              {addable.length > 0 && <button type="button" className="collab-add" title="Add a collaborator" onClick={() => setAddingCollab((v) => !v)}>+</button>}
              {addingCollab && (
                <div className="collab-menu">
                  {addable.map((k) => (
                    <button key={k} type="button" className="collab-opt" onClick={() => { setExtraCollabs((xs) => [...xs, k]); setAddingCollab(false); }}>
                      <Avatar p={PPL[k]} />{PPL[k].name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {route.pool && (
            <div>
              <div className="mlbl">Claim pool</div>
              <div className="collab-cell">
                <span className="collab-chip"><Avatar p={PPL.nikhil} /><span className="collab-names">Nikhil</span></span>
                <span className="collab-chip"><Avatar p={PPL.nandu} /><span className="collab-names">Nandu</span></span>
              </div>
            </div>
          )}
          <div>
            <div className="mlbl">Not on this task</div>
            <div className="collab-cell">
              {notOnIt.length ? notOnIt.map((k) => (
                <span key={k} className="collab-chip off" title={`${PPL[k].name} is not involved`}><Avatar p={PPL[k]} /><span className="collab-names">{PPL[k].name}</span></span>
              )) : <span className="collab-names" style={{ color: "var(--faint)" }}>Everyone is on it</span>}
            </div>
          </div>
        </div>
        <div className="nt-route-why">{route.why}</div>
        {/* "Give me option to add to claim pool" (Nandu, 13 Oct). The pool is approved
            video work, so this is a shortcut for filing it at Content - Approved. */}
        {isVideoType(type) && (
          <label className="nt-pool-tick" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: "#232D42", cursor: "pointer" }}>
            <input type="checkbox" checked={status === "Content - Approved"} style={{ accentColor: "#3A57E8" }}
              onChange={(e) => setStatus(e.target.checked ? "Content - Approved" : "Content - Pending")} />
            Put it in the claim pool now — Nikhil or Nandu claims it
          </label>
        )}
      </div>

      <div className="nt-field"><label className="nt-label">Content <span className="nt-hint">optional — you can write it after creating the task</span></label><AutoTextarea className="nt-input nt-textarea" value={content} onChange={setContent} minHeight={140} placeholder="Write the content / brief here — hook, body, CTA, specs…" /></div>
      {/* Reels + YouTube long-form: the thumbnail is part of the same job, so it is
          asked here rather than filed as an unrelated task later. Who MAKES it is a
          separate question, because these days the editor who cuts the reel usually
          makes its thumbnail too — see docs/THUMBNAIL_FLOW_SPEC.md. */}
      {canHaveThumb && (
        <div className="nt-thumb">
          <label className="nt-thumb-ask">
            <input type="checkbox" checked={wantsThumb} onChange={(e) => setWantsThumb(e.target.checked)} />
            <span className="nt-thumb-asktext">Does this also need a thumbnail?</span>
            <span className="nt-thumb-type">{thumbType}</span>
          </label>
          {wantsThumb && (
            <div className="nt-thumb-body">
              <div className="nt-field">
                <label className="nt-label">Thumbnail particulars <span className="nt-hint">leave blank to name it after the video</span></label>
                <input className="nt-input" value={thumbTitle} onChange={(e) => setThumbTitle(e.target.value)} placeholder={thumbTitleFinal || "e.g. AMC Exam Guide — Thumbnail"} />
              </div>
              <div className="nt-field">
                <label className="nt-label">Thumbnail brief <span className="nt-req">required</span> <span className="nt-hint">headline text, key visual, reference</span></label>
                <AutoTextarea className="nt-input nt-textarea" value={thumbContent} onChange={setThumbContent} minHeight={84} placeholder="What should the thumbnail say and show?" />
              </div>
              <div className="nt-field">
                <label className="nt-label">Who makes it</label>
                <div className="nt-thumb-who">
                  {THUMB_WHO.map((o) => (
                    <button type="button" key={o.value}
                      className={`nt-thumb-opt ${thumbWho === o.value ? "on" : ""}`}
                      onClick={() => setThumbWho(o.value)}>
                      <span className="nt-thumb-opt-lbl">{o.label}</span>
                      <span className="nt-thumb-opt-sub">{o.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* The publishing date, SBU and priority are the video's — the thumbnail
                  ships with it, so there is nothing separate to set. */}
              <div className="nt-thumb-note">
                It takes the video&apos;s SBU, publishing date and priority. {thumbWho === "praveen"
                  ? `${PPL[firstWithRole("designer") || ""]?.name || "The designer"} gets it as soon as you save.`
                  : "It is saved now and stays out of everyone's list until the video is claimed."}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Same files cards as My Day and the task window (22 Oct). */}
      <div className="nt-field">
        <PendingAssets title="References" value={refs} onChange={setRefs} />
      </div>
      <div className="nt-field">
        <PendingAssets title="Creatives & files" drop oneLink value={output} onChange={setOutput} />
        <span className="nt-hint" style={{ display: "block", marginTop: ".35rem" }}>Finishing it yourself? Drop the ready creative here — otherwise leave it for the designer.</span>
      </div>
      <div className="nt-field">
        <PendingAssets title="Attachments" noLinks value={att} onChange={setAtt} />
      </div>
      <div className="nt-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={create} style={canSubmit ? undefined : { opacity: .55 }} title={canSubmit ? undefined : `Still missing: ${missing.join(", ")}`}>Create task</button>
      </div>
      {gate && <MissingFieldsModal gate="create" missing={missing} title={title.trim() || "This task"} onClose={() => setGate(false)} />}
    </>
  );
}
