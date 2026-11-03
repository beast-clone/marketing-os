// Every rule the dashboard runs on, written for people, grouped by the tab it
// affects (Praveen, 26 Oct: "it should be easily readable … break it down tab-wise").
//
// This is a READ of the system, not a second copy of it: `where` says which file
// or table really decides, so anyone can check. Nothing here changes behaviour.
// The rules the team CAN change (who gets new and approved tasks) are rows in
// mh_rules and are edited on the My Day tab of the Rules page, not listed here.
//
// `editable`: "team" = changed on the dashboard (Rules page or Team & access);
// "airtable" = set in Airtable; "code" = ask a developer.

export type RuleEditability = "team" | "airtable" | "code";

export type Rule = {
  id: string;
  /** The moment it applies — shown as the tag ("Content - Approved", "Moving a date"). */
  when: string;
  /** What happens, in the words someone would use to describe it out loud. */
  what: string;
  why?: string;
  where: string;
  editable: RuleEditability;
};

export type RuleTab = {
  key: string;
  title: string;
  blurb: string;
  rules: Rule[];
};

// The path every task takes, drawn as steps at the top of the My Day tab.
export const TASK_FLOW: { step: string; status: string; who: string }[] = [
  { step: "1 · Writing", status: "Content - Pending", who: "With the writer — whoever has the Writer role on Team & access" },
  { step: "2 · Approved", status: "Content - Approved", who: "Handed over by the owner rules below — the first rule that fits decides who gets it" },
  { step: "3 · Producing", status: "Output - In Progress", who: "With whoever is designing or editing" },
  { step: "4 · Review", status: "Output - Ready", who: "Goes to Content Review" },
  { step: "5 · Publish", status: "Ready to Publish", who: "Picked up by the Scheduler" },
];

export const RULE_TABS: RuleTab[] = [
  {
    key: "my-day",
    title: "My Day",
    blurb: "How a task travels from idea to published, and who holds it at each step.",
    rules: [
      { id: "owner-writer", when: "Content - Pending", what: "The task stays with whoever is writing it. Nothing is handed over until the content is approved.", where: "NewTaskForm.tsx · routeFor()", editable: "code" },
      { id: "approve-gate", when: "Approving", what: "A task can only be approved once it has the brief, the SBU, a priority and a publishing date.", where: "/api/marketing-hub/update · approve gate", editable: "code" },
      { id: "video-types", when: "Design or video?", what: "Video means Reel - Original, Reel - Cut, YouTube Long-Form, YouTube Shorts, Story (Video) and Meta Ads - Video. Everything else is design work.", where: "lib/mh-content-types.ts · VIDEO_TYPES (and sql/013)", editable: "code" },
      { id: "pipeline-hold", when: "Producer's day is full", what: "The task waits in their Pipeline until they press Accept. It is never forced onto a full day.", where: "/api/marketing-hub/update · deferHandoff", editable: "code" },
      { id: "claim", when: "Claiming a task", what: "Whoever claims it becomes the owner. The person who shot a video stays on as collaborator.", where: "/api/marketing-hub/takeover", editable: "code" },
      { id: "pair", when: "On-camera pair", what: "When someone presents a pool video, the edit goes straight to their edit partner; when the partner edits one, they go on camera. No partner = it stays in the pool.", where: "Team & access · When they present, editing goes to", editable: "team" },
      { id: "collab-never-owner", when: "Collaborators", what: "Nobody is ever both owner and collaborator. Any collaborator can be taken off with the × on their chip.", where: "lib/task-create.ts · My Day task detail", editable: "code" },
      { id: "swap", when: "Packed producer", what: "They can't push work away themselves — they offer their not-started tasks and the Writer picks which one moves (Swap).", where: "/api/my-day/swap-request", editable: "code" },
      { id: "time-up", when: "Time runs out", what: "The owner is asked: Task completed, or Extend with a reason. The rest of the team sees the extension.", where: "PreviewMyDay.tsx · time-up alert", editable: "code" },
      { id: "date-approval", when: "Publishing date moved", what: "The Manager moves a publishing date directly. Anyone else's change becomes a request the Manager approves or declines.", where: "Team & access · Role in the workflow, Date changes need approval", editable: "team" },
      { id: "date-why", when: "Moving a date", what: "Asks why the date moved — switched on or off for each person on Team & access.", where: "Team & access · Ask why when a date moves", editable: "team" },
      { id: "day", when: "Your day", what: "8 hours from when you sign in, never before your shift start. Lunch 1–2 PM is protected and the last hour stays free for urgent work.", where: "Team & access · Shift starts", editable: "team" },
      { id: "order", when: "Order of today's plan", what: "Overdue first, then Urgent/High, then by publishing date — until you drag it; your order then holds until you press Rearrange.", where: "PreviewMyDay.tsx", editable: "team" },
      { id: "spill", when: "Too much for today", what: "Only what fits the shift is drawn on the timeline; the rest is listed separately instead of being crammed in.", where: "PreviewMyDay.tsx · fitPlan / spillPlan", editable: "code" },
      { id: "estimates", when: "No time set", what: "Each type of content has a default time — set in Default time per task type above.", why: "Used only when nobody has set a duration by hand.", where: "Rules · My Day · Default time per task type", editable: "team" },
      { id: "samvaya", when: "Samvaya work", what: "Shown only in Nandu's own Samvaya section, never mixed with GooCampus work.", where: "/api/my-day · isSamvayaRow", editable: "code" },
    ],
  },
  {
    key: "review",
    title: "Content Review",
    blurb: "The check between finished output and the Scheduler.",
    rules: [
      { id: "output-gate", when: "Output - Ready", what: "A task can only be marked Ready once a creative file or an output link is attached.", where: "/api/marketing-hub/update · output gate", editable: "code" },
      { id: "push", when: "Push to Schedule", what: "Moves it to Ready to Publish — only with a real caption (the brief doesn't count), the creative uploaded as a file (a Drive or Canva link can't be posted to Instagram or Facebook), at least 2 slides for a carousel (the LinkedIn PDF isn't a slide), and a publishing date.", where: "/api/marketing-hub/update · publish gate", editable: "code" },
      { id: "send-back", when: "Send back", what: "Moves it to Incorporating Feedback with your note; the note is highlighted on the producer's task.", where: "content-review/page.tsx", editable: "code" },
      { id: "changed", when: "Creative changed", what: "If the creative is swapped after approval, the card says “Changed after approval” so it is checked again.", where: "content-review/page.tsx", editable: "code" },
    ],
  },
  {
    key: "scheduler",
    title: "Scheduler",
    blurb: "What is checked before anything goes out.",
    rules: [
      { id: "pick-page", when: "Choosing the page", what: "Nothing is pre-ticked — the social media person picks the page(s) every time.", where: "scheduler/page.tsx", editable: "code" },
      { id: "review-step", when: "Before posting", what: "A review shows the page(s), the networks and the time. Nothing goes out until you press Yes.", where: "scheduler/page.tsx · submit()", editable: "code" },
      { id: "per-day", when: "Posts per day", what: "Set for each page in Posting limits above. Going over warns first.", where: "Rules · Scheduler · Posting limits", editable: "team" },
      { id: "gap", when: "Gap between posts", what: "Set for each page in Posting limits above; the Scheduler offers the next free slot.", where: "Rules · Scheduler · Posting limits", editable: "team" },
      { id: "big-reel", when: "Big reels", what: "Instagram rejects reels over 300 MB from here, so you are warned before posting.", where: "scheduler/page.tsx", editable: "code" },
      { id: "linkedin", when: "LinkedIn", what: "Ticked by itself when the page has a LinkedIn page. A PDF goes to LinkedIn as a carousel.", where: "scheduler/page.tsx", editable: "code" },
      { id: "send-ahead", when: "Scheduled posts", what: "Files are sent about 30 minutes early and published on time, even when nobody is online.", where: "n8n Publisher v3", editable: "code" },
    ],
  },
  {
    key: "calendar",
    title: "Content calendar",
    blurb: "Which posts show where.",
    rules: [
      { id: "account", when: "Which account", what: "Mentorship Platform → GooCampus World. 12thPlus.com and India NEET UG → 12th Plus. 10K Mentorship and everything else → GooCampus Main. Samvaya → none of ours.", where: "Rules · Content calendar · Primary Interests and their page", editable: "team" },
      { id: "drag", when: "Dragging a post", what: "Only people with “Edit calendar” switched on can drag a post to another day.", where: "Team & access · Edit calendar", editable: "team" },
      { id: "views", when: "Calendar views", what: "Anyone can save a calendar view for themselves or the whole team — for example Mentorship.", where: "Content calendar · + New view", editable: "team" },
    ],
  },
  {
    key: "notify",
    title: "Notifications & Slack",
    blurb: "Who hears about what, and where.",
    rules: [
      { id: "notify-creator", when: "Task changes stage", what: "Whoever created it is told each time it moves on in someone else's hands.", where: "lib/notifications.ts", editable: "code" },
      { id: "notify-owner", when: "Handed to you", what: "The owner is told when a task is handed to them, sent back, or waiting in their Pipeline.", where: "lib/notifications.ts", editable: "code" },
      { id: "pop", when: "Pop-ups", what: "Only things that need a decision pop up. Everything else goes to the bell (it shakes) and the unread count.", where: "NotificationHost.tsx", editable: "code" },
      { id: "quiet", when: "Quiet hours", what: "No pop-ups at weekends, outside your shift (Shift starts on Team & access), or after you press End day.", where: "/api/notifications · isQuiet()", editable: "team" },
      { id: "due-today", when: "Due today", what: "Nudged before the end of the shift, while there is still time — how early is set in Due-today reminder above.", where: "Rules · Notifications · Due-today reminder", editable: "team" },
      { id: "slack", when: "Slack — #marketing-os-updates", what: "Posted when content needs approval, is approved, output is ready for review, work is sent back, a swap is asked for, or a publishing-date change is asked, approved or declined.", where: "lib/slack.ts", editable: "code" },
      { id: "messages", when: "Messages tab", what: "Only what people type. Automatic updates go to Notifications, not the chat.", where: "/api/my-day/chat", editable: "code" },
    ],
  },
  {
    key: "access",
    title: "Team & access",
    blurb: "Who can see and do what.",
    rules: [
      { id: "work-role", when: "Role in the workflow", what: "Each person is a Writer, Designer, Editor or Manager. That decides who gets approved design work, who claims videos, who picks swaps and who approves date changes.", where: "Team & access · Role in the workflow", editable: "team" },
      { id: "toggles", when: "Every permission", what: "Is an on/off switch for each person on Team & access — nothing is wired to a name.", where: "Team & access", editable: "team" },
      { id: "tabs", when: "Tabs", what: "Each sidebar tab shows only for people who have it switched on.", where: "lib/permissions.ts · Team & access", editable: "team" },
      { id: "create", when: "Creating tasks", what: "Only people with “Create tasks” switched on see + New task.", where: "Team & access · Create tasks", editable: "team" },
      { id: "admins", when: "Admins", what: "Admins see everything and can edit any view. Who is an admin is set on Team & access.", where: "Team & access", editable: "team" },
    ],
  },
  {
    key: "data",
    title: "Deleting & Airtable",
    blurb: "Safety nets, and what comes in from Airtable.",
    rules: [
      { id: "confirm", when: "Deleting anything", what: "Always asks Delete or Cancel first.", where: "ConfirmDialog · every delete", editable: "code" },
      { id: "bin", when: "Deleted tasks and files", what: "Go to the Recycle bin and can be restored from there.", where: "lib/task-trash.ts", editable: "code" },
      { id: "sync-hourly", when: "Hourly Airtable sync", what: "Only adds new tasks from Airtable's “Task Dashboard” view. It never overwrites the team's own edits.", why: "On a timer it would quietly undo changes made here.", where: "/api/cron/import-airtable", editable: "airtable" },
      { id: "sync-button", when: "Sync from Airtable button", what: "Copies every Airtable field over the dashboard's row — press it on purpose, not by habit.", where: "Master sheet · Sync from Airtable", editable: "team" },
      { id: "statuses", when: "Statuses", what: "The eleven statuses come from Airtable's Status field: Content - Pending, In Progress, Needs Approval, Approved · Output - In Progress, Ready · Incorporating Feedback · Ready to Publish · Published/Scheduled · Rejected/Not Published · Failed.", where: "Airtable · Status field", editable: "airtable" },
    ],
  },
];
