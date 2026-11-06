// All defaults are UTILITY (Praveen, 6 Nov): utility templates are far less likely
// to be rejected, so the three that started as marketing were reworded to be about
// the person's own enquiry or session. Meta still has the final say on category.
//
// GooCampus's default WhatsApp templates — the set kept ready for when a chat's
// 24-hour window has closed. Approved by Praveen from the prototype, 6 Nov 2026
// (public/mockups/wa-templates.html).
//
// This file is the catalog only. Whether each one exists, and Meta's verdict on it,
// comes live from Meta (/api/wa-inbox/templates?all=1), matched by name.
//
// `typed` marks blanks that are a free-typed message rather than a short value —
// the composer shows a big box for those. Meta refuses a template that is mostly a
// blank, so the fixed words around a typed blank must stay.

export type DefaultTemplate = {
  name: string;
  category: "UTILITY" | "MARKETING";
  when: string;
  body: string;
  /** One example per blank, in order — Meta reviews the template with these. */
  example: string[];
  /** 1-based blank numbers that hold a whole typed message. */
  typed?: number[];
  buttons: string[];
  note?: string;
};

export type DefaultGroup = { title: string; sub: string; items: DefaultTemplate[] };

export const DEFAULT_FOOTER = "GooCampus Edu Solutions";

export const DEFAULT_GROUPS: DefaultGroup[] = [
  { title: "Reopen a chat", sub: "The most-used set: someone wrote to us and the 24 hours ran out before we answered.", items: [
    { name: "gc_message_from_team", category: "UTILITY", when: "Type any message of your own. The template wraps it so Meta accepts it.",
      body: "Hi {{1}}, here's a message from the GooCampus team:\n\n{{2}}\n\nReply to this message to continue the conversation.",
      example: ["Priya", "Your NEET PG documents are verified. Our counsellor will share the college list by Friday."], typed: [2], buttons: ["Reply", "Call me"],
      note: "Meta can refuse a template that is mostly a blank, so the fixed lines around it stay." },
    { name: "gc_enquiry_update", category: "UTILITY", when: "Your own message, tied to their enquiry — the utility version (Meta made gc_message_from_team marketing).",
      body: "Hi {{1}}, an update about your enquiry with GooCampus:\n\n{{2}}\n\nReply to this message if you have any questions.",
      example: ["Priya", "Your documents are verified and the counsellor will share your college options by Friday."], typed: [2], buttons: ["Reply", "Call me"],
      note: "Use this one first — it is charged as utility. gc_message_from_team stays for anything that isn't about their enquiry." },
    { name: "gc_missed_reply_followup", category: "UTILITY", when: "We didn't reply in time.",
      body: "Hi {{1}}, sorry we couldn't reply to your message about {{2}} in time. Our team is available now — just reply to this message and we'll pick up where we left off.",
      example: ["Priya", "NEET PG counselling"], buttons: ["Continue chat", "Call me"] },
    { name: "gc_callback_missed", category: "UTILITY", when: "A counsellor called and couldn't reach them.",
      body: "Hi {{1}}, {{2}} from GooCampus tried calling you about your {{3}} enquiry. Reply with a good time and we'll call you back.",
      example: ["Rahul", "Robin", "UK PG pathway"], buttons: ["Call me today", "Call tomorrow"],
      note: "Similar already approved: goocampus_callback_alert (sent on lead assignment)." },
  ] },
  { title: "Enquiries and leads", sub: "First contact, and what happens after a counselling call.", items: [
    { name: "gc_enquiry_received", category: "UTILITY", when: "Right after a form, call or ad enquiry.",
      body: "Hi {{1}}, thanks for your enquiry about {{2}}. A GooCampus counsellor will get back to you shortly — reply here anytime with your questions.",
      example: ["Meera", "studying medicine in Georgia"], buttons: ["Talk to a counsellor"] },
    { name: "gc_next_steps", category: "UTILITY", when: "After a counselling call — the counsellor types what they need to do next.",
      body: "Hi {{1}}, thanks for speaking with {{2}} today about {{3}}.\n\nYour next steps: {{4}}\n\nReply here with any questions.",
      example: ["Arjun", "Robin", "the AMC pathway", "Book the AMC MCQ slot and send your passport copy."], typed: [4], buttons: ["I have a question"] },
  ] },
  { title: "Sessions and appointments", sub: "Counselling sessions, mentor sessions and office visits.", items: [
    { name: "gc_session_booked", category: "UTILITY", when: "As soon as a session is booked.",
      body: "Hi {{1}}, your session with {{2}} is booked for {{3}}. Join here: {{4}}\n\nReply to this message if you need to change it.",
      example: ["Karthik", "Dr. Anjali", "Sat 8 Nov, 11:00 AM", "https://meet.google.com/abc-defg-hij"], buttons: ["Reschedule"] },
    { name: "gc_session_reminder", category: "UTILITY", when: "The day before, or an hour before.",
      body: "Hi {{1}}, a reminder of your session with {{2}} on {{3}}. Reply YES to confirm, or RESCHEDULE if you need another time.",
      example: ["Karthik", "Dr. Anjali", "Sat 8 Nov, 11:00 AM"], buttons: ["Yes", "Reschedule"],
      note: "Similar already approved: neet_pg_al_ameen_reminder (one event only)." },
    { name: "gc_session_missed", category: "UTILITY", when: "They didn't join.",
      body: "Hi {{1}}, we missed you at your session with {{2}} today. Reply to this message and we'll find a new time that suits you.",
      example: ["Karthik", "Dr. Anjali"], buttons: ["Pick a new time"] },
  ] },
  { title: "Applications and documents", sub: "Keeping students moving through their application.", items: [
    { name: "gc_documents_pending", category: "UTILITY", when: "We're waiting on documents.",
      body: "Hi {{1}}, to continue with your {{2}} we still need: {{3}}. You can send them right here as a photo or PDF.",
      example: ["Ananya", "Australia PGCP application", "passport copy and MBBS degree"], buttons: ["Sending now"] },
    { name: "gc_documents_received", category: "UTILITY", when: "Confirm we got them.",
      body: "Hi {{1}}, we've received your {{2}}. Our team will review them and update you by {{3}}. Thank you!",
      example: ["Ananya", "passport copy and MBBS degree", "Monday"], buttons: [] },
    { name: "gc_application_status", category: "UTILITY", when: "Any change in their application.",
      body: "Hi {{1}}, an update on your {{2}}: {{3}}\n\nReply to this message if you have any questions.",
      example: ["Ananya", "Australia PGCP application", "your offer letter has been issued."], typed: [3], buttons: ["I have a question"] },
  ] },
  { title: "Payments", sub: "Programme fees and consultations (eBooks already have their own).", items: [
    { name: "gc_payment_pending", category: "UTILITY", when: "A payment was started but not finished.",
      body: "Hi {{1}}, your payment of Rs {{2}} for {{3}} is still pending. You can complete it here: {{4}}\n\nReply to this message if you need any help.",
      example: ["Sneha", "4,999", "the UK Mentorship Program", "https://goocampus.in/pay"], buttons: [],
      note: "Similar already approved: *_payment_failed_retry (eBooks only)." },
    { name: "gc_payment_received", category: "UTILITY", when: "Receipt for a programme payment.",
      body: "Hi {{1}}, we've received your payment of Rs {{2}} for {{3}}. Thank you! Our team will contact you with the next steps.",
      example: ["Sneha", "4,999", "the UK Mentorship Program"], buttons: [] },
  ] },
  { title: "Updates and events", sub: "News that affects them, and webinars or seminars.", items: [
    { name: "gc_important_update", category: "UTILITY", when: "Counselling round results, deadlines, visa slots.",
      body: "Hi {{1}}, there's an update on {{2}}:\n\n{{3}}\n\nReply to this message if you have any questions.",
      example: ["Arjun", "your NEET PG counselling", "Round 2 seat allotment results are out."], typed: [3], buttons: ["I have a question"] },
    { name: "gc_event_reminder", category: "UTILITY", when: "For people who registered for a webinar or seminar.",
      body: "Hi {{1}}, a reminder that {{2}} starts {{3}}. Join here: {{4}}\n\nSee you there!",
      example: ["Divya", "the UK PLAB webinar", "today at 6:00 PM", "https://goocampus.in/live"], buttons: [] },
    { name: "gc_event_invite", category: "UTILITY", when: "Details of a webinar or seminar for someone who asked about it.",
      body: "Hi {{1}}, as requested, here are the details of {{2}} on {{3}}: {{4}}\n\nReply YES to confirm your seat.",
      example: ["Divya", "the UK PLAB webinar", "Sat 15 Nov at 6:00 PM", "Our doctors who cleared PLAB will answer questions live."], buttons: ["Yes, confirm my seat", "Not this time"] },
  ] },
  { title: "Follow up", sub: "People who went quiet on an enquiry, and feedback after a session.", items: [
    { name: "gc_reconnect_offer", category: "UTILITY", when: "A lead who went quiet on their enquiry.",
      body: "Hi {{1}}, following up on your enquiry about {{2}}: {{3}}\n\nReply to this message if you'd like to continue.",
      example: ["Vikram", "the AMC pathway", "the February batch application deadline is 30 November."], buttons: ["Yes, let's continue", "Not now"] },
    { name: "gc_feedback_request", category: "UTILITY", when: "After a session or programme they attended.",
      body: "Hi {{1}}, thank you for attending {{2}}. Please rate it from 1 to 5 so we can follow up on anything you need.",
      example: ["Karthik", "your mentor session"], buttons: ["5 - Excellent", "3 - Okay", "1 - Poor"],
      note: "Similar exists on another GooCampus WhatsApp account: client_feedback_request." },
  ] },
];

export const DEFAULT_TEMPLATES: DefaultTemplate[] = DEFAULT_GROUPS.flatMap((g) => g.items);

/** Which blanks of a template are a whole typed message (by name, from the catalog). */
export const typedBlanks = (name: string): number[] => DEFAULT_TEMPLATES.find((t) => t.name === name)?.typed ?? [];
