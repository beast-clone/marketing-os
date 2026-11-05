import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicOrigin } from "@/lib/public-origin";

const LIVE = "https://goocampus-ig-dashboard.netlify.app";
const req = (url: string, fwd?: string) => new Request(url, fwd ? { headers: { "x-forwarded-host": fwd } } : undefined);

describe("publicOrigin — sign-in return address", () => {
  const prev = process.env.APP_URL;
  beforeEach(() => { process.env.APP_URL = LIVE; });
  afterEach(() => { process.env.APP_URL = prev; });

  it("live site comes back to the live site", () => {
    expect(publicOrigin(req(`${LIVE}/api/auth/google/start`, "goocampus-ig-dashboard.netlify.app"))).toBe(LIVE);
  });
  it("a preview link comes back to itself", () => {
    expect(publicOrigin(req("https://x.netlify.app/a", "igtest--goocampus-ig-dashboard.netlify.app")))
      .toBe("https://igtest--goocampus-ig-dashboard.netlify.app");
  });
  it("never the deploy-permalink host", () => {
    expect(publicOrigin(req("https://6aeb1c685b5a403623b04ca9--goocampus-ig-dashboard.netlify.app/a", "6aeb1c685b5a403623b04ca9--goocampus-ig-dashboard.netlify.app"))).toBe(LIVE);
  });
  it("no forwarded host falls back to APP_URL", () => {
    expect(publicOrigin(req("https://6aeb1c685b5a403623b04ca9--goocampus-ig-dashboard.netlify.app/a"))).toBe(LIVE);
  });
  it("another domain uses APP_URL", () => {
    expect(publicOrigin(req("https://evil.example/a", "evil.example"))).toBe(LIVE);
  });
  it("localhost keeps its own port", () => {
    expect(publicOrigin(req("http://localhost:3000/api/auth/google/start"))).toBe("http://localhost:3000");
  });
});
