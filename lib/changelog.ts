// What changed in the dashboard, written for the team.
//
// Hand-written on purpose. A changelog generated from commit messages reads like
// engineering notes — it tells you a function was renamed, not that the button you
// press every morning now goes somewhere different. Every entry here says what it is
// now and, where it helps, what it was before, because "what was there and what was
// changed" is the whole point.
//
// Adding a release: put a new object at the TOP of RELEASES. Keep `what` to one
// sentence someone outside this file would understand, and use `before` only when the
// change is confusing without it.

export type ChangeKind = "new" | "fixed" | "changed" | "removed";

export type Change = {
  kind: ChangeKind;
  /** The headline, in the team's language, not the codebase's. */
  what: string;
  /** One or two sentences. Say what it was before if that is what makes it land. */
  detail: string;
  /** Which tab this affects — drives the filter. */
  where: string;
};

export type Release = {
  /** YYYY-MM-DD, the day it reached the live site. */
  date: string;
  title: string;
  summary: string;
  changes: Change[];
};

export const RELEASES: Release[] = [
  {
    date: "2026-11-03",
    title: "Reports for every month, year and person, Airtable Backup, and Samvaya in the Scheduler",
    summary: "Every month's report in one list, a yearly report and team reports, a read-only backup of Airtable's Content Calendar, Marketing OS as an app, and Samvaya Matrimony wherever our pages are — plus \"Primary Interest\" instead of \"brand\" and a search box in long dropdowns.",
    changes: [
      { kind: "new", what: "Every monthly report in a list", detail: "Monthly Reports has All reports on the left — click a month to open it. Each report shows only its own month. A month that has ended opens from its saved copy in a moment (October used to take about 10 seconds), and every month is saved on its own when it ends.", where: "Reports" },
      { kind: "fixed", what: "Monthly report numbers", detail: "Stories always showed 0 — they're now counted from the saved stories. A 31-day month showed no reach (Meta allows 30 days at a time); it now shows the last 30 days and says so. LinkedIn counted the latest posts whatever their date; it now counts only the month's.", where: "Reports" },
      { kind: "new", what: "Yearly report", detail: "Content made and published by Primary Interest, month, type and owner (Airtable Backup and the Master sheet together, each task counted once), and leads, Instagram, YouTube and LinkedIn month by month. Every table has Copy table.", where: "Reports" },
      { kind: "new", what: "Team report and each person's report", detail: "Team, then each person under their role. A person's report is their own job only — content writer: content approved; designer: designs delivered; video editor: videos delivered — with on time, sent back, turnaround and every task. Work they did in another role is listed under Additional roles. Admins see everyone; others see only their own.", where: "Reports" },
      { kind: "new", what: "Add a section to a report", detail: "Give it a title and paste a table — copied cells come out as a table. Each month, year or person keeps its own sections.", where: "Reports" },
      { kind: "new", what: "Airtable Backup", detail: "A read-only copy of Airtable's Content Calendar from April 2026 — 1,607 tasks with all their fields and files — so nothing is lost. Tick-box filters, a count by Primary Interest with Copy table, and every task's details. It never shows up in My Day or notifications.", where: "Content" },
      { kind: "new", what: "Install Marketing OS as an app", detail: "In Chrome or Edge, the card at the bottom of the sidebar installs it on your Mac or Windows — it opens in its own window from the Dock or Start menu, always up to date.", where: "Overview" },
      { kind: "new", what: "Samvaya Matrimony in the Scheduler and calendars", detail: "Samvaya Matrimony is a page you can post to, has its own calendar in Content calendar, and is a Primary Interest. Any brand linked on the Brands page now shows up in the Scheduler, the calendars and Team & access by itself.", where: "Scheduler" },
      { kind: "fixed", what: "A post can't go to the wrong page", detail: "A page the publisher didn't recognise used to go out on GooCampus. It now fails with a clear message instead, and only GooCampus and GooCampus World posts cross-post to LinkedIn.", where: "Scheduler" },
      { kind: "changed", what: "\"Primary Interest\", not \"brand\"", detail: "Filters, columns and forms that meant an SBU now say Primary Interest. \"Brand\" is kept for the real brands on the Brands page. Add a Primary Interest from the Publishing Calendar's filter.", where: "Content calendar" },
      { kind: "new", what: "Search in long dropdowns", detail: "Any dropdown with more than 8 choices — Primary Interests above all — has a search box at the top. Capitals don't matter.", where: "Overview" },
      { kind: "changed", what: "Important notifications drop from the bell", detail: "They appear in one place, just under the bell (which rings): with the sender's photo when a person needs you, as a Marketing OS card otherwise, and stacked with a count when there are several.", where: "Overview" },
      { kind: "changed", what: "New loading animation", detail: "The Marketing OS M with a blue ring running round it, instead of the bars.", where: "Overview" },
      { kind: "fixed", what: "Plan board on Team & access", detail: "Plan board had no switch, so it couldn't be given or taken away. It has one now — and a new page can't go live without its switch.", where: "System" },
    ],
  },
  {
    date: "2026-10-30",
    title: "Plan board, Copy link, approval history, and rules that are really in charge",
    summary: "Plan by hand on the new Plan board, share any task or post with one link, see every date change that was approved, and the Rules page now decides who gets each task.",
    changes: [
      { kind: "new", what: "Plan board", detail: "A new tab above Content calendar: write and draw with your mouse, a pen or your finger, like on paper — pen, highlighter, eraser, colours, undo. Nearly straight lines snap straight (turn it off with \"Straight lines\"). Each person's board is saved and only they see it. The calendar boards are coming soon.", where: "Content" },
      { kind: "fixed", what: "The rules on the Rules page are really used now", detail: "Rules were saved but tasks ignored them — the main switch had been off since 27 Oct, so every approved design task still went to Praveen (a 12thPlus carousel went to Praveen instead of Nandu). The switch is on: who gets a task follows the Rules page, and every \"goes to Praveen\" note now names whoever the rules pick.", where: "Marketing Hub" },
      { kind: "new", what: "Approvals history", detail: "The Approvals tab has a History view: every publish-date change that was approved or rejected, by whom and when, with counts per admin.", where: "My Workspace" },
      { kind: "fixed", what: "\"Approved the date change request\", not \"rescheduled this\"", detail: "Approving a date change showed in the task's activity as if the approver had rescheduled it. It now says \"approved the date change request\" (or \"declined…\"), and the request reads \"asked to change the publish date\".", where: "Marketing Hub" },
      { kind: "new", what: "Copy link on posts and tasks", detail: "Every post in the Scheduler, every item in Content Review and every post in the Publishing Calendar has Copy link — paste it in WhatsApp or Slack and it opens straight on that post. Someone who isn't signed in comes back to it after signing in.", where: "Scheduler" },
      { kind: "new", what: "API keys tab", detail: "Every outside service the dashboard connects to, what it's used for and whether its key is set (values are never shown). \"Copy as a list\" gives a list ready to send.", where: "System" },
    ],
  },
  {
    date: "2026-10-29",
    title: "Attendance, Marketing Leads, Brands, and maps",
    summary: "A rebuilt Attendance tab, Marketing Leads for DM leads, a Brands page to connect each brand's accounts, India and world maps wherever geography shows, and Samvaya on Instagram, Facebook and YouTube.",
    changes: [
      { kind: "fixed", what: "Started shows the real time before 9 AM", detail: "Signing in at 8:58 showed \"Started 9:00 AM\" — anything before 9 was rounded up. It now shows 8:58. Today's plan still begins at your shift.", where: "My Day" },
      { kind: "new", what: "Attendance tab", detail: "Day, week, month or a custom range: when each person arrived and left, hours worked (lunch taken off), a graph, and a PDF report with the graph that you can preview first.", where: "My Workspace" },
      { kind: "changed", what: "Social Leads is now Marketing Leads", detail: "It shows only DM leads (paid ad leads stay in Campaigns), by brand, with a custom date range, the date and time of each lead, and whether a counsellor has contacted them — the same rule as Sales Hub. New lead sources (like WhatsApp) are flagged so an admin can add them as a tab.", where: "Sales" },
      { kind: "new", what: "Maps wherever geography shows", detail: "\"Where your followers are\" and every other location list now has the list on the left and a map on the right — India by state, or the world by country.", where: "Analytics" },
      { kind: "removed", what: "Organic Sales tab", detail: "It repeated e-Book Orders from incomplete Airtable data. e-Book Orders (Organic Sales) is the one e-Book tab.", where: "Sales" },
      { kind: "new", what: "Brands page", detail: "Every brand, its logo (upload one) and which of its Instagram, Facebook, LinkedIn and YouTube accounts are really connected. Add a brand, connect its Instagram + Facebook by picking its page, and send a YouTube connect link to a channel's owner.", where: "System" },
      { kind: "new", what: "Samvaya Matrimony is connected", detail: "Instagram, Facebook and YouTube now show Samvaya's real numbers, and its logo is in the brand picker.", where: "Overview" },
      { kind: "changed", what: "YouTube follows the brand picker", detail: "The YouTube tabs had their own GooCampus / 12thplus / Samvaya buttons on top of the brand dropdown. Now the dropdown at the top decides, like every other tab.", where: "YouTube" },
      { kind: "fixed", what: "Notification icons", detail: "The bell used emojis; it now uses the dashboard's own icons.", where: "Overview" },
    ],
  },
  {
    date: "2026-10-28",
    title: "GEO SEO, eBooks, filters that stay, and posts that go to the right place",
    summary: "A new GEO SEO tab, eBook Orders straight from Razorpay, filters that remember what you picked, videos that play with sound, and the Scheduler sending each file where it can actually be posted.",
    changes: [
      { kind: "new", what: "GEO SEO tab", detail: "Type a topic and it finds the real questions people ask on Google India, then checks every week (Mondays 9 AM) whether ChatGPT, Gemini, Google's AI Overview and Perplexity name us. Full answers, competitors named, history, usage and a downloadable report. \"Check now\" runs it any time; a monthly spending cap stops it at the limit.", where: "GEO SEO" },
      { kind: "new", what: "eBooks down the left, click one to see only its orders", detail: "Every eBook is listed with its paid orders. Add a new eBook or remove one that has no orders, with undo.", where: "Marketing Hub" },
      { kind: "changed", what: "Sync from Razorpay asks for the payment page link", detail: "Paste the eBook's Razorpay link: the eBook fills itself in, every sale comes across, and you see Razorpay's sold count next to ours so a mismatch is obvious. Totals leave ₹1 test payments out.", where: "Marketing Hub" },
      { kind: "fixed", what: "Filters stay what you picked", detail: "Before, switching calendar wiped the statuses, unticking an SBU quietly switched the account to All, and coming back ticked every SBU again. Each calendar now keeps its own SBUs; the date range sticks across pages; Pipeline, Workload and My Day remember their view; a saved Master sheet view opens from its latest saved version.", where: "Content calendar" },
      { kind: "new", what: "Unselect all in tick-box filters", detail: "Untick everything, then tick just the few you want.", where: "Content calendar" },
      { kind: "fixed", what: "Whole creatives on every card", detail: "Post cards cut the top and bottom off portrait creatives and captions showed half a third line. Cards now show the full 4:5 creative and captions stop at whole lines — Overview, Posts, Reels, Facebook, Benchmark, the briefing, file tiles and more.", where: "Overview" },
      { kind: "fixed", what: "Reels play with sound", detail: "Opening a reel showed a still picture. Reels, video ads and video slides now play, with sound, wherever you open them — and without black bars beside tall videos.", where: "Overview" },
      { kind: "new", what: "Each creative says where it will be posted", detail: "Pictures (PNG/JPG) are For Instagram · Facebook; a set of MP4 slides is For Instagram; the PDF is For LinkedIn. Upload the same design as MP4s and as PNGs and they show as two groups.", where: "My Day" },
      { kind: "changed", what: "Scheduler sends each set where it can go", detail: "Facebook can't take a carousel with video slides — it posted a still. Now the video slides go to Instagram and the pictures to Facebook in the same post, and Facebook gets every picture, not just the first. Videos over 300 MB upload fine and go to Facebook only (Instagram doesn't take them from outside its app).", where: "Scheduler" },
      { kind: "new", what: "Download all as a zip, and Delete all", detail: "Creatives & files can be downloaded as one .zip in slide order or one by one, and deleted all at once or one group at a time (they go to the Recycle bin).", where: "My Day" },
      { kind: "new", what: "Paste files into Create post", detail: "Ctrl/Cmd+V drops a copied file into the post's media, like the files boxes in My Day.", where: "Scheduler" },
      { kind: "new", what: "Video and picture ads open in full", detail: "Clicking an ad on the Ads page plays its video or shows its full picture.", where: "Ads" },
      { kind: "fixed", what: "Quora, MouthShut and ValueMD get their own search", detail: "They always read 0 because one search covered all four sites and Reddit filled every result. Each site is now searched on its own.", where: "Content Radar" },
      { kind: "changed", what: "Tab icon follows your browser's theme", detail: "A white M in dark mode, blue in light mode.", where: "System" },
      { kind: "new", what: "Search finds pages", detail: "Type a tab's name in Ask / search — \"content calendar\", \"ebook\", \"reels\" — and it shows the page, including tabs inside folders. Enter opens the top one. You only see pages you have access to.", where: "System" },
    ],
  },
  {
    date: "2026-10-27",
    title: "Rules you can read, and creatives in order",
    summary: "The Rules page in plain sentences, owner changes that stick, and carousels whose slides and LinkedIn PDF can't be mixed up.",
    changes: [
      { kind: "changed", what: "Rules page in plain sentences", detail: "Who gets each task, posting limits, default task times and the due-today reminder are written as sentences you can edit, and every change is confirmed.", where: "Marketing Hub" },
      { kind: "fixed", what: "Changing the owner of an approved design task sticks", detail: "It used to snap back to Praveen. The owner is also never listed as a collaborator on their own task.", where: "Marketing Hub" },
      { kind: "changed", what: "Slides first, the LinkedIn PDF on its own row", detail: "A carousel's PDF showed as \"slide 11\" and got deleted as a stray slide. Slides and the PDF now sit in separate rows, the viewer counts slides first, and deleting a file asks why.", where: "My Day" },
      { kind: "changed", what: "Stricter checks before Push to Schedule", detail: "A post can't go to the Scheduler with something missing.", where: "Content Review" },
      { kind: "changed", what: "Roles, shifts and the on-camera pair are set on Team & access", detail: "No longer fixed in the code by name.", where: "System" },
      { kind: "changed", what: "My Day chat shows chats only", detail: "Notifications no longer appear in the chat column.", where: "My Day" },
    ],
  },
  {
    date: "2026-10-26",
    title: "Airtable-style views and a preview beside the task",
    summary: "Saved views and filters like Airtable, every delete asks first, and attachments open next to the task.",
    changes: [
      { kind: "new", what: "Views like Airtable", detail: "The Master sheet and Content calendar have saved views in a side rail — create, find, fold into sections, share. The Mentorship calendar is now one of these views.", where: "Marketing Hub" },
      { kind: "new", what: "Filters like Airtable", detail: "Condition groups, date options, chips you can copy and reorder.", where: "Marketing Hub" },
      { kind: "changed", what: "Every delete asks first", detail: "Delete / Cancel everywhere on the dashboard, so a stray click can't remove anything.", where: "System" },
      { kind: "new", what: "Attachments open beside the task", detail: "A task opens with its first attachment showing; Copy a picture in one click, or open it full screen at real size. Tasks at Output Ready or later open with their creatives showing.", where: "My Day" },
      { kind: "new", what: "eBook Orders tab", detail: "Razorpay eBook sales in the Marketing Hub section.", where: "Marketing Hub" },
      { kind: "changed", what: "Scheduler: no page pre-ticked, and a review step", detail: "You pick the page each time and see a summary before it posts. 10K posts go to the Main page.", where: "Scheduler" },
      { kind: "new", what: "Copy task link, and a cleaner History", detail: "Copy a link to any task; History shows newest first, only what changed, and folds runs of similar changes into one line.", where: "My Day" },
      { kind: "changed", what: "Approval steps post to Slack", detail: "Messages shows only typed chat; approval alerts go to #marketing-os-updates.", where: "System" },
    ],
  },
  {
    date: "2026-10-23",
    title: "Marketing Hub pages and files you can drag",
    summary: "Expenses, Essential Photos, Marketing Material, Paid Promotions and Subscriptions as their own pages, plus paste and drag-to-reorder for files.",
    changes: [
      { kind: "new", what: "Marketing Hub section", detail: "Expenses, Essential Photos (as folders), Marketing Material (list, grid and a large viewer, with Level tabs), Paid Promotions and Subscriptions.", where: "Marketing Hub" },
      { kind: "new", what: "Paste files into any files box", detail: "Ctrl/Cmd+V adds a copied screenshot or file.", where: "My Day" },
      { kind: "new", what: "Drag file tiles to change the slide order", detail: "", where: "My Day" },
      { kind: "changed", what: "Links and files open in a side panel", detail: "Next to the task instead of over the whole screen.", where: "My Day" },
      { kind: "changed", what: "Workload matches each person's My Day plan", detail: "Same tasks, same saved order, same buffer. Today's plan stays fixed from login; finished tasks shrink instead of the day sliding.", where: "Workload" },
      { kind: "fixed", what: "Ownership by type works both ways", detail: "Design and video tasks hand over in either order, and owner changes report what really saved.", where: "Marketing Hub" },
    ],
  },
  {
    date: "2026-10-22",
    title: "Send ahead, post on time — and a new My Day",
    summary: "Posts are sent to Instagram 30 minutes early and go live on the minute; My Day gets a new header, task panel and report.",
    changes: [
      { kind: "new", what: "Send ahead, post on time", detail: "The file goes to Instagram and Facebook up to 30 minutes before, so the post goes live at exactly its time. The Scheduler shows publishing history, live status and why a post failed.", where: "Scheduler" },
      { kind: "new", what: "Recycle bin for files", detail: "Deleted files can be restored from System → Recycle bin.", where: "System" },
      { kind: "changed", what: "New My Day", detail: "A new header with date and IST time, Today's plan as a progress bar, a one-column task panel, views (In progress, Output ready and your own), My report, and \"Completed by me\" with date ranges.", where: "My Day" },
      { kind: "new", what: "End day posts the day report", detail: "Log out sends your day report to the team's Telegram group; newly published posts are posted there too.", where: "My Day" },
      { kind: "new", what: "Back to where you were", detail: "The dashboard reopens your last page, last open task and unsaved drafts.", where: "System" },
      { kind: "changed", what: "Every access setting is a switch", detail: "Team & access has per-tab pages, Scheduler pages, task actions and \"Ask why when a date moves\" as switches per person.", where: "System" },
      { kind: "changed", what: "Uploads up to 2 GB, with a progress ring", detail: "One files card everywhere; duplicates are called out.", where: "My Day" },
      { kind: "new", what: "Sales Hub follow-up card", detail: "Assigned leads and follow-ups at a glance.", where: "Sales Ops" },
    ],
  },
  {
    date: "2026-10-21",
    title: "Every comment from 9–16 October",
    summary: "The team's comments from the last two weeks, plus a stronger editor and uploads without the 6 MB limit.",
    changes: [
      { kind: "new", what: "Paste images and links into a task", detail: "Pasted images upload; pasted links are clickable and open on click.", where: "My Day" },
      { kind: "changed", what: "Content and caption always editable", detail: "Airtable-style, with the usual editor shortcuts, checklists and quotes; pasted bullets stay bullets.", where: "My Day" },
      { kind: "new", what: "Create a task with just its name", detail: "Title, format and SBU can be edited in the task window afterwards.", where: "Marketing Hub" },
      { kind: "changed", what: "Claim pool for videos", detail: "New videos go straight into the claim pool, the owner can put one back, and \"on camera\" counts on the presenter's day.", where: "My Day" },
      { kind: "new", what: "PDFs as creatives and references", detail: "Shown as page previews; Content Review has a swipeable side-by-side slider and whole images on cards.", where: "Content Review" },
      { kind: "fixed", what: "Uploads no longer stop at 6 MB", detail: "Files go straight to storage.", where: "My Day" },
      { kind: "changed", what: "Date approval is a per-person switch", detail: "Any admin can approve a date change.", where: "System" },
      { kind: "changed", what: "Instagram, Facebook and LinkedIn in one Scheduler panel", detail: "One tab, with a Publishing… state that can't be changed mid-post.", where: "Scheduler" },
      { kind: "fixed", what: "End day really signs you out", detail: "", where: "My Day" },
    ],
  },
  {
    date: "2026-10-08",
    title: "Everything the team reported",
    summary: "Every comment left on the dashboard is now dealt with — the board, the calendar, the review queue, the Radar and the YouTube tab.",
    changes: [
      // ── My Day ──────────────────────────────────────────────────────────────
      {
        kind: "fixed",
        what: "Reference links open",
        detail: "A reference is usually written as a citation with the link inside it, and the whole line was being treated as the address — so clicking it went nowhere. The link inside the text is now the one that opens.",
        where: "My Day",
      },
      {
        kind: "fixed",
        what: "Every status is in the status list",
        detail: "The dropdown offered eight stages when the board has eleven, so the missing ones could not be set from here at all.",
        where: "My Day",
      },
      {
        kind: "new",
        what: "Say you are on camera after a video has been claimed",
        detail: "\"Present on camera\" only ever appeared on videos still sitting unclaimed, so once an editor took one there was no way left to register as the presenter. The task itself now has an On camera row, and choosing it puts you on the task as a collaborator so it shows on your board.",
        where: "My Day",
      },
      {
        kind: "new",
        what: "The two editors pair up by themselves",
        detail: "Pick \"on camera\" on a video nobody has claimed and the editing goes to the other editor; claim the editing while nobody is on camera and the other editor is put on camera. It only ever fills a blank — if somebody already owns it, or is already on camera, that is left alone.",
        where: "My Day",
      },
      {
        kind: "changed",
        what: "Click the owner to hand a task over",
        detail: "Reassigning was only reachable from the header button or by entering edit mode first, so clicking the owner's name — the obvious thing — did nothing.",
        where: "My Day",
      },
      {
        kind: "fixed",
        what: "An empty claim pool says where the work went",
        detail: "A blank Approved tab looked the same whether there was no work or somebody had already taken it, so a claim could look like it had vanished. It now reads \"Nothing up for grabs — Nikhil is working on 1 video\".",
        where: "My Day",
      },
      // ── Marketing Hub ───────────────────────────────────────────────────────
      {
        kind: "fixed",
        what: "Approving no longer asks for a collaborator first",
        detail: "The check was circular: you needed somebody on the task to run the step that puts people on it, and for video it could never be satisfied at all because video is meant to reach the editors' pool unassigned.",
        where: "Marketing Hub",
      },
      {
        kind: "changed",
        what: "The Master sheet reopens the way you left it",
        detail: "Filter, sort, hidden columns, colour and grouping now stay until you change them or press Clear, the way an Airtable view does. Going to the Content Calendar and back no longer resets them. Search is deliberately not kept.",
        where: "Marketing Hub",
      },
      {
        kind: "changed",
        what: "Status colours match Airtable",
        detail: "The old set were pastels at almost the same lightness, so on the calendar everything read as one off-white, and four statuses had no colour at all. They now come from the Content Calendar's own Status field.",
        where: "Marketing Hub",
      },
      {
        kind: "new",
        what: "Filter the calendar by several brands at once, and by status",
        detail: "The brand picker took one at a time, so seeing three meant looking three times, and there was no status filter at all. Both hold what to show, both say what is hidden, and both stay set when you leave the tab.",
        where: "Marketing Hub",
      },
      {
        kind: "fixed",
        what: "Content reads as content, not as symbols",
        detail: "Half the briefs are written with ### and ** around them and none of it was being formatted, so the symbols were printed as typed. Headings, bold, lists and links now render — which is also what makes references read as headings.",
        where: "Marketing Hub",
      },
      {
        kind: "changed",
        what: "A task opens on its content",
        detail: "Opening a task showed the creatives upload box and an empty references panel first, with the writing below the fold. Content and Caption now come first.",
        where: "Marketing Hub",
      },
      {
        kind: "fixed",
        what: "Priority can be changed from the task panel",
        detail: "It was shown but not editable, so changing it meant going back to the grid.",
        where: "Marketing Hub",
      },
      // ── Content Review ──────────────────────────────────────────────────────
      {
        kind: "new",
        what: "Filter the review queue by interest",
        detail: "Chips above the cards, one per brand actually waiting, with its count. These do not stay set between visits on purpose — this is a queue of work waiting on you, and a filter left on could hide something that arrived while you were away.",
        where: "Content Review",
      },
      // ── Scheduler ───────────────────────────────────────────────────────────
      {
        kind: "fixed",
        what: "A video handed over as a link no longer looks lost",
        detail: "Work delivered as a Drive or Canva link showed as an empty \"Upload media\" box from content review onward, so the video appeared to disappear. The card now says it was delivered as a link and names where it points. The file is still needed to publish.",
        where: "Scheduler",
      },
      {
        kind: "fixed",
        what: "Sending a task back keeps the caption",
        detail: "Edits made to the caption were dropped when the task went back for changes, so the work had to be done twice.",
        where: "Scheduler",
      },
      // ── Content Radar ───────────────────────────────────────────────────────
      {
        kind: "new",
        what: "Official sources, told apart from reporting",
        detail: "A dropdown for official sources, third-party, or official first with everything still showing. Official means the body that decides the thing — MCC, NMC, NBEMS, AMC, the GMC — rather than a publication writing about it.",
        where: "Content Radar",
      },
      {
        kind: "new",
        what: "Notices from the authorities themselves",
        detail: "The watchers have been reading the MCC counselling pages every hour and the Radar had no idea they existed. Their notices now appear as their own lane, above everything except an unanswered review. Six more authorities were added to the watch: NMC, NBEMS, NTA, the Australian Medical Council, USMLE and the Medical Council of Ireland.",
        where: "Content Radar",
      },
      // ── YouTube ─────────────────────────────────────────────────────────────
      {
        kind: "fixed",
        what: "The 12thplus tab loads again",
        detail: "It answered \"subscriber count unavailable\" while the credentials were fine. Each request was minting its own access token, and because the channels share one Google account, each new token quietly killed the one another request was still using. The app now holds a single token and retries once if it is revoked.",
        where: "YouTube",
      },
      {
        kind: "new",
        what: "Samvaya has a channel tab",
        detail: "It says \"not connected\" until two things are done: its channel link is supplied, and the dashboard's Google account is added as a manager on the channel in YouTube Studio. It will never show invented numbers.",
        where: "YouTube",
      },
      // ── Signing in ──────────────────────────────────────────────────────────
      {
        kind: "new",
        what: "A way back in when you forget your password",
        detail: "Forgot password? on the sign-in screen emails you a code, you set a new password and you are signed in. Previously somebody had to re-invite you.",
        where: "My Account",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Connect Claude by signing in",
    summary: "No more keys to copy. Click Connect, sign in, approve — the way Airtable and Notion do it.",
    changes: [
      {
        kind: "new",
        what: "Claude connects with a sign-in, not a key",
        detail: "In Claude, add the connector and click Connect. A GooCampus screen opens, you sign in with the login you already have, click Approve, done. There is no key to copy, keep or lose.",
        where: "Connectors",
      },
      {
        kind: "changed",
        what: "The personal key is now the fallback, not the main way",
        detail: "It still works and existing setups are untouched, but it's tucked behind “I need a personal key instead”. Handing people a secret to carry is how one ended up pasted into a chat window on day one.",
        where: "Connectors",
      },
      {
        kind: "new",
        what: "You can see and cut off what's connected",
        detail: "Connectors lists each Claude that has access and when it connected. “Disconnect everything” kills them all instantly — not at the next expiry, immediately.",
        where: "Connectors",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Connectors, and a clock",
    summary: "Setting Claude up has its own page now, with the steps for the app and the website — not just the terminal.",
    changes: [
      {
        kind: "new",
        what: "Connectors has its own page under System",
        detail: "Claude sits there with step-by-step setup for whichever one you use: the Claude desktop app, claude.ai in a browser, or Claude Code in a terminal. It also spells out what Claude is and isn't allowed to do here, so nobody has to find out by trying.",
        where: "System",
      },
      {
        kind: "changed",
        what: "Connecting Claude moved off My Account",
        detail: "It used to be a box at the bottom of My Account that only ever explained the terminal, which is no use if you use the Claude app. Same key, same button — it's under System → Connectors now.",
        where: "My Account",
      },
      {
        kind: "changed",
        what: "The brand picker shows each brand's own logo",
        detail: "It used to badge every brand with an Instagram glyph, which was misleading — the Overview shows Instagram, Facebook, LinkedIn and YouTube together, not just Instagram. GooCampus, GooCampus World, 12thPlus and Samvaya now each carry their real profile picture.",
        where: "Overview",
      },
      {
        kind: "new",
        what: "The time, in the Overview header",
        detail: "A digital clock next to the notification bell showing the day, the full date and the running time, always in IST — it reads the same whatever timezone the laptop is set to. It has nothing to do with attendance: it isn't recorded anywhere.",
        where: "Overview",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Content Studio, rebuilt",
    summary: "Perplexity checks whether it's true, Claude writes it, and it lands on the board with the caption already in it.",
    changes: [
      {
        kind: "fixed",
        what: "“Write this” now actually goes somewhere",
        detail: "It used to send you to the Scheduler, which ignored everything it was handed — the headline, the source and the brief were thrown away on arrival. It now opens Content Studio with all of it attached.",
        where: "Content Radar",
      },
      {
        kind: "new",
        what: "The facts get checked before anyone writes",
        detail: "On a real story this caught a headline saying the NEET PG answer key was live when NBEMS hadn't released it. It runs on its own the moment you arrive, so there's no button to remember.",
        where: "Content Studio",
      },
      {
        kind: "changed",
        what: "Claude writes the copy now, not Perplexity",
        detail: "Same key, same bill — Claude was already available and unused. You can still take the prompt into the Claude app if you'd rather work on it there.",
        where: "Content Studio",
      },
      {
        kind: "new",
        what: "Nothing reaches the board unseen",
        detail: "Before a task is created you see every field — type, brand, owner, date, caption, source, fact-check — and can change any of them. It flags what's blank, like a time-sensitive piece with no publishing date.",
        where: "Content Studio",
      },
      {
        kind: "new",
        what: "Playbooks are connected to writing at last",
        detail: "The angle you pick in Create is a playbook, and its framework goes into the prompt. Before this the library was fifty documents you could read and nothing that read them.",
        where: "Content Studio",
      },
      {
        kind: "removed",
        what: "The trending strip and the research box",
        detail: "The strip was a second, worse Content Radar — six cards, often the same story three times. The research box charged ₹10–30 a go to do what the Radar already does.",
        where: "Content Studio",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Nothing falls off the Radar unnoticed",
    summary: "Every item now gets an answer, and at 11:59 PM the day is written down — including what nobody touched.",
    changes: [
      {
        kind: "new",
        what: "Thumbs up and down on every row",
        detail: "“Not useful” is a real answer and takes one tap. Before this the only way to clear something was to write the post, so nothing ever got cleared.",
        where: "Content Radar",
      },
      {
        kind: "new",
        what: "Say why you turned something down",
        detail: "Asked after the thumb, never before, and you can skip it — five one-tap reasons or your own words. The report then shows the reason instead of just “not useful”.",
        where: "Content Radar",
      },
      {
        kind: "new",
        what: "The Report and the Log",
        detail: "The Report says what was done about each item, including the ones nobody touched. The Log is the plain record of everything the Radar produced that day. Both download as Markdown or PDF.",
        where: "Content Radar",
      },
      {
        kind: "new",
        what: "A line in My Day when something urgent was missed",
        detail: "One line, once, the next morning: what was time-sensitive yesterday and got nothing. It goes away on its own the day after.",
        where: "My Day",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Google Reviews, connected",
    summary: "4.9 stars from 378 reviews — and, more usefully, the complaints that need answering.",
    changes: [
      {
        kind: "new",
        what: "Complaints rank above everything else on the page",
        detail: "It's the only thing on the Radar where doing nothing keeps costing money. The button says “Reply on Google”, because a complaint has to be answered where it was left.",
        where: "Content Radar",
      },
      {
        kind: "new",
        what: "Good reviews become posts",
        detail: "Recent five-star reviews with actual words are offered as content. A bare rating with no comment isn't — there's nothing to quote.",
        where: "Content Radar",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "The Radar is easier to read",
    summary: "It opens on one source instead of four kinds of row at once, and every row is laid out the same way.",
    changes: [
      {
        kind: "changed",
        what: "It opens on Google News",
        detail: "The mixed list put news, Reddit threads, reviews and rising searches in one column, each with its own shape — noise before it was a ranking. Tap any source tile to switch, or “Show everything” for the old view.",
        where: "Content Radar",
      },
      {
        kind: "changed",
        what: "One refresh button, named after what it refreshes",
        detail: "There were two buttons both called refresh, doing different things. Now there's one, and it says “Refresh Google News” or “Refresh Google Trends” depending on where you are. Reddit and Quora have none — they're searched live every time you open the page, so there's nothing to pull.",
        where: "Content Radar",
      },
      {
        kind: "changed",
        what: "Topics is now Google Alerts",
        detail: "Same screen, familiar name. Each one is searched for news every hour, and the row tells you how many stories it has actually found.",
        where: "Content Radar",
      },
      {
        kind: "fixed",
        what: "Articles open properly again",
        detail: "“Couldn't pull the article body” was the server running a version of Node one release too old for one of the reader's dependencies. The version is now pinned so it can't drift again.",
        where: "Content Radar",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Finding a task, and sharing one",
    summary: "A link you can paste into Slack, and the task you just made no longer disappears into 145 rows.",
    changes: [
      {
        kind: "new",
        what: "Copy a link to any task",
        detail: "Like Airtable's record link. Paste it into Slack or WhatsApp and whoever clicks it lands on that task, instead of searching for it by name.",
        where: "Marketing Hub",
      },
      {
        kind: "fixed",
        what: "Opening a task lands you on the master sheet",
        detail: "It used to open the task over the Workload planner, so closing it dropped you on somebody's day timeline with no sign of what you'd just opened. Fixed everywhere — notifications, My Day, the reports and Team Command.",
        where: "Marketing Hub",
      },
      {
        kind: "new",
        what: "The task you came for stays highlighted",
        detail: "It's scrolled to the middle of the screen and stays marked until you navigate away — not a flash that fades, because you usually look for it a minute later.",
        where: "Marketing Hub",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Playbooks tell the truth now",
    summary: "No more “Verified” on things nothing verified, and no more offering to turn a text message into a carousel.",
    changes: [
      {
        kind: "fixed",
        what: "“Verified” only appears when something was actually verified",
        detail: "The green tick used to show on every result — including a WhatsApp template that cited nothing. A badge that can't tell the difference teaches people to ignore it.",
        where: "Content Studio",
      },
      {
        kind: "fixed",
        what: "No more wrong formats after a copy playbook",
        detail: "After writing three WhatsApp messages it asked whether to turn them into an Instagram carousel or a blog article. Playbooks that write the finished thing now just give you the copy.",
        where: "Content Studio",
      },
      {
        kind: "new",
        what: "Regenerate, in a different tone",
        detail: "Not happy with it? Pick professional, friendly, direct or warm and run it again, from where the result is.",
        where: "Content Studio",
      },
      {
        kind: "new",
        what: "Use your own prompt instead",
        detail: "A button next to Run playbook. Your instructions replace the playbook's; the GooCampus context is still added for you.",
        where: "Content Studio",
      },
      {
        kind: "fixed",
        what: "A rate limit no longer says you're out of credit",
        detail: "Running several playbooks at once used to report “out of quota — top up your plan” on an account with money in it. It now says to wait a few seconds, which is all it needs.",
        where: "Content Studio",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "What the AI has been doing",
    summary: "Every Playbook and Content Studio run, what was asked of it, and what it cost.",
    changes: [
      {
        kind: "new",
        what: "A usage report in Content Studio",
        detail: "Runs, tokens, spend, and how many used a custom prompt. Each row opens to show the full task and the person's own prompt. Admins only.",
        where: "Content Studio",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Published links fill themselves in",
    summary: "When a post goes live, the dashboard finds its link instead of waiting for someone to paste it.",
    changes: [
      {
        kind: "new",
        what: "Instagram, Facebook and LinkedIn links found automatically",
        detail: "A nightly job matches published posts to their tasks and fills in the link. It won't match a reel to a static-post task, or claim a post that already belongs to another task.",
        where: "Marketing Hub",
      },
    ],
  },
  {
    date: "2026-09-27",
    title: "Tasks, thumbnails and the day's plan",
    summary: "One task form everywhere, and the thumbnail question asked at the right moment.",
    changes: [
      {
        kind: "changed",
        what: "The same New task form everywhere",
        detail: "Including from the Content Calendar, so a task can be raised where the gap actually is.",
        where: "Marketing Hub",
      },
      {
        kind: "new",
        what: "The thumbnail question, asked once",
        detail: "When a reel or YouTube video is created you say whether it needs a thumbnail and who makes it — the editor who claims it, Praveen, or let them decide. Whoever claims it is asked if it was left open.",
        where: "Marketing Hub",
      },
      {
        kind: "changed",
        what: "The activity feed reads top to bottom",
        detail: "Oldest first, as a timeline, with people's real names instead of their keys.",
        where: "Marketing Hub",
      },
    ],
  },
];
