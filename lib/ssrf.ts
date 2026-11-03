// Refuse to let the server fetch a URL that points back inside the network.
//
// Several features take a URL from a person and fetch it server-side: the Radar
// article reader, the watchers (a notice board anyone on the team can register),
// and the PDF summariser that follows links found on those boards. Without a
// check, each of those turns a Netlify function into a request proxy into the
// platform's private ranges and the cloud metadata endpoint at 169.254.169.254
// — and the watchers reflect the fetched page's links and anchor text straight
// back in the response, so it would not even be blind.
//
// This logic was written once for app/api/radar/article; it lives here so the
// other two call sites share it rather than each growing their own version.
//
// Two things worth keeping in mind when editing:
//   - DNS is resolved and every returned address checked, because a public
//     hostname is free to resolve to 127.0.0.1.
//   - A pass here is only good for the URL as given. Anything following
//     redirects has to re-check each hop, or an allowed host can 302 straight
//     to an internal address.

import net from "node:net";
import { lookup } from "node:dns/promises";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

// An IPv4 address hidden inside an IPv6 one — "::ffff:127.0.0.1", and the hex
// spelling the URL parser turns it into, "::ffff:7f00:1" (which got past the old
// check; security audit, 3 Nov 2026). Also the IPv4-compatible and NAT64 forms.
function embeddedV4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:|::|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16), lo = parseInt(m[3], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPrivateIp(ip: string): boolean {
  const v = embeddedV4(ip) || ip;
  if (net.isIPv4(v)) {
    const p = v.split(".").map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;              // link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // benchmarking
    if (p[0] >= 224) return true;                                // multicast + reserved
    return false;
  }
  const l = ip.toLowerCase();
  if (!net.isIPv6(l)) return true;                               // unparseable: refuse
  return l === "::1" || l === "::" || /^fe[89ab]/.test(l) || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("ff");
}

/** Throws when the URL is not a public http(s) address. */
export async function assertPublicUrl(urlStr: string): Promise<void> {
  const u = new URL(urlStr);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked protocol");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("blocked host");
  }
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error("blocked ip"); return; }
  const addrs = await lookup(host, { all: true });
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error("blocked resolved ip");
}

/** True when the URL is safe to fetch. For call sites that prefer to skip quietly. */
export async function isPublicUrl(urlStr: string): Promise<boolean> {
  try { await assertPublicUrl(urlStr); return true; } catch { return false; }
}

/** fetch() for a URL someone typed: checks the address, then follows redirects
 *  itself and checks every hop BEFORE requesting it — following them blindly let
 *  a public page 302 the server into the internal network. */
export async function safeFetch(urlStr: string, init: RequestInit & { timeoutMs?: number } = {}, maxHops = 5): Promise<Response> {
  let url = urlStr;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const r = await fetchWithTimeout(url, { ...init, redirect: "manual" });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) return r;
    if (hop >= maxHops) throw new Error("too many redirects");
    url = new URL(loc, url).href;
  }
}
