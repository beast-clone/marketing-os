// The dashboard's look for emails it sends (Praveen, 4 Nov 2026): logo, brand-blue
// header bar, white card on the gray canvas, labelled rows, buttons. Tables + inline
// styles only, so it renders the same in Gmail, Outlook and phone mail apps.

const APP_URL = (process.env.APP_URL || process.env.URL || "https://goocampus-ig-dashboard.netlify.app").replace(/\/+$/, "");

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Tone = "brand" | "green" | "red";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: "#3A57E8", fg: "#FFFFFF" },
  green: { bg: "#E6F6EC", fg: "#0F6E3C" },
  red: { bg: "#FDECEA", fg: "#C03221" },
};
const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";

/** rows: [label, value-html]. Values are HTML — escape anything a person typed with esc(). */
export function emailLayout(o: {
  preheader: string; tag: string; title: string; tone?: Tone; intro: string;
  rows: [string, string][]; quote?: { label: string; text: string };
  buttons: { label: string; href: string; primary?: boolean }[];
}): string {
  const t = TONE[o.tone || "brand"];
  const rows = o.rows.map(([k, v], i) => `<tr><td style="padding:11px 0;${i ? "border-top:1px solid #F0F1F5;" : ""}width:130px;vertical-align:top;font-size:13px;color:#8A92A6">${esc(k)}</td><td style="padding:11px 0;${i ? "border-top:1px solid #F0F1F5;" : ""}font-size:14px;color:#232D42">${v}</td></tr>`).join("");
  const quote = o.quote ? `<tr><td style="padding:4px 28px 8px"><div style="background:#E9ECFB;border-left:3px solid #3A57E8;border-radius:8px;padding:12px 14px"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#2138B0;font-weight:600;margin-bottom:4px">${esc(o.quote.label)}</div><div style="font-size:14px;line-height:1.5;color:#232D42">${esc(o.quote.text)}</div></div></td></tr>` : "";
  const buttons = o.buttons.map((b) => b.primary
    ? `<a href="${b.href}" style="display:inline-block;background:#3A57E8;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px;margin:0 8px 8px 0">${esc(b.label)}</a>`
    : `<a href="${b.href}" style="display:inline-block;background:#FFFFFF;color:#3A57E8;text-decoration:none;font-size:14px;font-weight:600;padding:10px 19px;border-radius:8px;border:1px solid #C9D1F6;margin:0 8px 8px 0">${esc(b.label)}</a>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6F7FB">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7FB;font-family:${FONT}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#FFFFFF;border:1px solid #E9ECF2;border-radius:14px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:${t.bg};padding:18px 20px 18px 28px;border-radius:13px 13px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${t.fg};opacity:.8;font-weight:600">${esc(o.tag)}</div>
<div style="font-size:19px;line-height:1.35;color:${t.fg};font-weight:600;margin-top:4px">${esc(o.title)}</div></td>
<td width="76" align="right" style="vertical-align:middle"><a href="${APP_URL}/dashboard/preview" style="display:inline-block;background:#FFFFFF;border-radius:10px;padding:6px 8px"><img src="${APP_URL}/goocampus-logo-small.png" width="60" height="51" alt="GooCampus" style="display:block;border:0"></a></td></tr></table></td></tr>
<tr><td style="padding:22px 28px 6px;font-size:14px;line-height:1.55;color:#4A5468">${o.intro}</td></tr>
<tr><td style="padding:0 28px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
${quote}
<tr><td style="padding:16px 28px 22px">${buttons}</td></tr>
</table></td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:#A6ACBE">Sent by the GooCampus dashboard · <a href="${APP_URL}/dashboard/preview/approvals" style="color:#8A92A6">Approvals</a><br>Who gets these emails is set on the Approvals page.</td></tr>
</table></td></tr></table></body></html>`;
}

/** A date written as a small pill — used for "from → to". */
export const datePill = (d: string, strong = false) => `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:13px;${strong ? "background:#3A57E8;color:#FFFFFF;font-weight:600" : "background:#F0F1F5;color:#4A5468;text-decoration:line-through"}">${esc(d)}</span>`;
