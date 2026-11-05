// Every outside call goes through fetchWithTimeout, which makes it the one place
// that can notice a slow upstream. These check it notices, and that it never
// writes a key into the log while doing so.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout, redactUrl, SLOW_MS } from "@/lib/fetch-with-timeout";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

/** Make the call appear to take `ms`, without actually waiting. */
function clockJump(ms: number) {
  let n = 0;
  vi.spyOn(Date, "now").mockImplementation(() => (n++ === 0 ? 0 : ms));
}

describe("noticing a slow upstream", () => {
  it("says so when a call crosses the threshold", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockJump(SLOW_MS + 1500);

    await fetchWithTimeout("https://graph.facebook.com/v23.0/me");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[slow upstream]");
    expect(String(warn.mock.calls[0][0])).toContain("4500ms");
  });

  it("stays quiet for a call that was fine", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockJump(200);

    await fetchWithTimeout("https://graph.facebook.com/v23.0/me");

    expect(warn).not.toHaveBeenCalled();
  });

  it("never writes the key into the log", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockJump(SLOW_MS + 1);

    await fetchWithTimeout("https://graph.facebook.com/v23.0/me?access_token=SECRET123&fields=id");

    const line = String(warn.mock.calls[0][0]);
    expect(line).not.toContain("SECRET123");
    expect(line).toContain("[redacted]");
  });

  it("redacts every kind of secret a URL carries", () => {
    const out = redactUrl("https://x.test/a?access_token=A&client_secret=B&api_key=C&code=D&fields=id");
    for (const s of ["A", "B", "C", "D"]) expect(out).not.toContain("=" + s);
    // The harmless parameter is left readable, or the log stops being useful.
    expect(out).toContain("fields=id");
  });
});
