// A link that opens a task in the Master sheet — what "Copy task link" puts on the
// clipboard (My Day, the task window, and right after a task is created).
export async function copyTaskLink(id: string) {
  const href = `${window.location.origin}/dashboard/preview/marketing-hub?tab=master&open=${id}`;
  try { await navigator.clipboard.writeText(href); } catch {
    const t = document.createElement("textarea"); t.value = href; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch { /* copied by hand */ } document.body.removeChild(t);
  }
}
