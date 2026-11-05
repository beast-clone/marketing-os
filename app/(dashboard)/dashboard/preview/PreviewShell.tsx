
// Shared the dashboard theme (Version 2) shell — theme root + the shared grouped sidebar
// (PreviewSidebar) + an optional topbar. Used by every cloned tab (via
// PreviewDashboardShell) so all V2 pages share one identical shell chrome.
export type PreviewTab =
  | "my-day" | "my-workspace" | "marketing-materials" | "overview" | "marketing-hub" | "calendar" | "content-review" | "scheduler" | "post-planner" | "radar" | "content-studio"
  | "broadcast" | "watchers"
  | "instagram" | "linkedin" | "youtube" | "facebook" | "website" | "seo" | "geo-seo" | "audience"
  | "ads" | "competitors" | "benchmark" | "leads" | "inbox" | "wa-inbox" | "sales" | "campaigns" | "ai-insights" | "ai-reports"
  | "integrations" | "diagnostics" | "tools" | "team" | "comments" | "account" | "reports" | "assistant" | "notifications"
  | "changelog" | "connectors" | "workflows" | "brands" | "api-keys" | "plan-board" | "archive";

export function PreviewShell({
  active, title, subtitle, children, headerRight, hideTopbar,
}: {
  active: PreviewTab;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  hideTopbar?: boolean;
}) {
  // The theme root, the flex shell and the sidebar all live in the route layout
  // now, so they survive navigation instead of being rebuilt per page. What's left
  // here is this page's own main column.
  void active;
  return (
    <main className="hmain">
      {!hideTopbar && (
        <div className="htopbar">
          <div className="htitle-wrap">
            <p className="hbanner">
              <b>{title}</b>
            </p>
            {subtitle && <p className="hsub">{subtitle}</p>}
          </div>
          {headerRight && <div className="htopbar-right">{headerRight}</div>}
        </div>
      )}
      {children}
    </main>
  );
}

export const SHELL_CSS = `
.preview-root{
  --bg:#F5F6FA;--panel:#FFFFFF;--panel-2:#F7F8FC;
  --ink:#232D42;--ink-soft:#4A5468;--muted:#8A92A6;--faint:#A6ACBE;
  --line:#EEF0F4;--line-2:#F3F5F9;
  /* Both forms, kept in step: the hex for this stylesheet's own var(--brand),
     the channels for Tailwind's bg-brand/text-brand inside this shell. */
  --brand:#3A57E8;--brand-soft:#E9ECFB;--brand-ink:#2138B0;
  --brand-rgb:58 87 232;--brand-dark-rgb:33 56 176;--brand-light-rgb:233 236 251;
  --good:#1AA053;--good-soft:#E3F5EA;--warn:#D97706;--warn-soft:#FEF3E2;--rose:#E11D48;--rose-soft:#FCE8EC;
  --sky:#0EA5E9;--sky-soft:#E4F4FD;--violet:#6E48F8;--violet-soft:#EFEBFE;
  --shadow:0 10px 30px rgba(35,45,66,0.06);
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
  color:var(--ink);background:var(--bg);min-height:100vh;font-size:14.5px;
}
.preview-root *{box-sizing:border-box}
.hshell{display:flex;align-items:stretch;min-height:100vh}
.hmain{flex:1;min-width:0;padding:clamp(1rem,2.2vw,2.2rem)}
.htopbar{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.1rem}
.hbanner{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:0;color:var(--muted);font-size:.82rem}
.hbanner b{color:var(--ink);font-size:.95rem;font-weight:500}
.htag{font-family:var(--mono);font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--brand-ink);background:var(--brand-soft);border-radius:5px;padding:.15em .5em;font-weight:600}
.hsub{margin:.3rem 0 0;color:var(--muted);font-size:.8rem}
.htopbar-right{display:flex;align-items:center;gap:.6rem}
`;
