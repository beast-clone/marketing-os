"use client";
import {  } from "@tabler/icons-react";
import { PreviewDashboardShell } from "@/app/(dashboard)/dashboard/preview/PreviewDashboardShell";
import { MonthlyReportView } from "../MonthlyReportView";

// Full monthly report in the team's Notion format (work in progress — see
// docs/MONTHLY_REPORT_SPEC.md). Phase 1: the imported month-over-month tables.
export default function Page() {
  return (
    <PreviewDashboardShell active="ai-reports" title="Monthly Report — full format" subtitle="Live data + imported history, in the team's monthly-report layout. Fill the sections marked with a pencil — they save per month." hideAccountPicker hideRange compact>
      {() => (
        <div className="max-w-[1200px] mx-auto">
          <MonthlyReportView month={new Date().toISOString().slice(0, 7)} />
        </div>
      )}
    </PreviewDashboardShell>
  );
}
