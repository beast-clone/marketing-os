"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconLogout, IconChevronDown, IconUserCog } from "@tabler/icons-react";

// The header profile chip: shows the REAL logged-in user (from /api/me) and opens
// a small menu with Log out (POST /api/logout — same endpoint the V1 sidebar uses).
// Previously the Overview header hard-coded "Maheen Ejaz" with no click handler, and
// the V2 sidebar has no logout, so there was no way to sign out of the dashboard.
type Me = { name?: string; initials?: string; role?: string; photoUrl?: string | null } | null;

export function HeaderProfile() {
  const [me, setMe] = useState<Me>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) setMe(d?.user ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const initials = me?.initials || "…";
  const name = me?.name || "Loading…";
  const role = me?.role || "";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {me?.photoUrl
          ? <img src={me.photoUrl} alt="" style={{ width: 38, height: 38, borderRadius: 999, objectFit: "cover" }} loading="lazy" decoding="async" />
          : <span style={{ width: 38, height: 38, borderRadius: 999, background: "linear-gradient(135deg,#3A57E8,#079AA2)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 600, fontSize: 14 }}>{initials}</span>}
        <div style={{ lineHeight: 1.2, textAlign: "left" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#232D42" }}>{name}</div>
          <div style={{ fontSize: 12, color: "#8A92A6" }}>{role}</div>
        </div>
        <IconChevronDown size={15} stroke={1.8} style={{ color: "#8A92A6", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "#fff", border: "1px solid #EEF0F4", borderRadius: 12, minWidth: 190, padding: 6, boxShadow: "0 10px 30px rgba(35,45,66,0.12)", zIndex: 30 }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #F3F5F9", marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#232D42" }}>{name}</div>
            <div style={{ fontSize: 12, color: "#8A92A6" }}>{role}</div>
          </div>
          <Link
            href="/dashboard/preview/account"
            onClick={() => setOpen(false)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 14, color: "#232D42", textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F7FB")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <IconUserCog size={16} stroke={1.8} /> My account
          </Link>
          <form action="/api/logout" method="post">
            <button
              type="submit"
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", background: "none", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, color: "#C03221", textAlign: "left" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#FCE8EC")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <IconLogout size={16} stroke={1.8} /> Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
