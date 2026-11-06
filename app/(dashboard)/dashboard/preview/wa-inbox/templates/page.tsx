"use client";
import { useEffect, useState } from "react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import TemplatesTab from "../TemplatesTab";

// WhatsApp Inbox → Templates — its own page under the WhatsApp Inbox folder in the
// sidebar, like Scheduler's sub-pages (Praveen, 6 Nov). ?new=1 opens the
// "New template" form straight away (the chat composer links here with it).
export default function Page() {
  const [startNew, setStartNew] = useState<boolean | null>(null);
  useEffect(() => { setStartNew(new URLSearchParams(window.location.search).get("new") === "1"); }, []);
  return (
    <PreviewDashboardShell active="wa-inbox" title="WhatsApp Templates"
      subtitle="Every template on +91 74116 54951, Meta's status for each, and GooCampus's default set."
      hideAccountPicker hideRange>
      {() => (startNew === null ? null : <TemplatesTab startNew={startNew} />)}
    </PreviewDashboardShell>
  );
}
