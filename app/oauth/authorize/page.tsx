import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { rosterById } from "@/lib/team-db";
import { getClient } from "@/lib/oauth";
import { canConnectClaude } from "@/lib/permissions";

// The approval screen — the one thing in this flow a person actually sees.
//
// Deliberately outside /dashboard: it is reached from the Claude app, often before
// anyone has signed in, and the middleware's dashboard gate drops the path it was
// heading to. Here we do the session check ourselves so we can hand /login a `next`
// and bring them straight back.
//
// A plain <form> POST, no JavaScript: it is the last step before handing out access,
// and it should not depend on a bundle loading.

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || "");

export default async function AuthorizePage({ searchParams }: { searchParams: Params }) {
  const clientId = one(searchParams.client_id).trim();
  const redirectUri = one(searchParams.redirect_uri).trim();
  const state = one(searchParams.state);
  const challenge = one(searchParams.code_challenge).trim();
  const method = (one(searchParams.code_challenge_method) || "plain").trim();
  const responseType = one(searchParams.response_type).trim();

  // Not signed in → go and sign in, then come straight back here with every
  // parameter intact. Losing them would mean starting the whole flow again.
  const userId = getSessionUserId();
  if (!userId) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") qs.set(k, v);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  // Anything wrong with the request is shown here rather than bounced back to the
  // client: a bad request is usually a misconfiguration, and a silent redirect makes
  // that impossible to debug.
  const client = clientId ? await getClient(clientId) : null;
  const problem =
    !clientId ? "No client_id was sent."
    : !client ? "That app isn't registered with this dashboard."
    : !redirectUri ? "No redirect_uri was sent."
    : !client.redirectUris.includes(redirectUri) ? "That app asked to be sent somewhere it hasn't registered."
    : responseType !== "code" ? `Unsupported response_type "${responseType}".`
    : !challenge ? "This app didn't send a PKCE challenge, which this dashboard requires."
    : method !== "S256" ? "This dashboard only accepts the S256 PKCE method."
    : null;

  if (problem) return <Shell><Problem title="This sign-in request isn't valid" body={problem} /></Shell>;

  const me = await rosterById(userId!);
  const allowed = canConnectClaude(me);
  if (!allowed) {
    return (
      <Shell>
        <Problem
          title="You don't have the Claude connector turned on"
          body={`Ask an admin to switch on “Connect Claude” for ${me?.name || "your account"} on the Team page, then try again.`}
        />
      </Shell>
    );
  }

  const host = (() => { try { return new URL(redirectUri).host || redirectUri; } catch { return redirectUri; } })();

  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-[19px] font-semibold text-[#232D42]">
          Connect <span className="text-brand">{client!.name}</span> to GooCampus?
        </h1>
        <p className="text-[13.5px] text-[#8A92A6] mt-1.5">
          Signed in as <b className="font-medium text-[#4A5468]">{me!.name}</b>. It will act as you.
        </p>
      </div>

      <div className="mt-5 rounded-xl border border-gray-100 bg-[#F6F7FB] p-4">
        <p className="text-[12px] font-semibold text-[#8A92A6] uppercase tracking-wider mb-2">It will be able to</p>
        <ul className="space-y-1.5">
          <Li yes>Create tasks on the content board</Li>
          <Li yes>Read tasks, search them, see what&apos;s due or overdue</Li>
          <Li yes>Change status, dates, priority, owner and copy</Li>
          <Li yes>Read what Content Radar has found</Li>
        </ul>
        <p className="text-[12px] font-semibold text-[#8A92A6] uppercase tracking-wider mt-3.5 mb-2">It will not be able to</p>
        <ul className="space-y-1.5">
          <Li>Delete anything — there is no such tool</Li>
          <Li>Move a task to a different Primary Interest</Li>
          <Li>Publish anything, anywhere</Li>
          <Li>See your password, or act as anyone else</Li>
        </ul>
      </div>

      <form action="/api/oauth/approve" method="POST" className="mt-5">
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={challenge} />
        <input type="hidden" name="state" value={state} />
        <div className="flex gap-2.5">
          <button type="submit" name="decision" value="deny"
            className="flex-1 h-11 rounded-lg border border-gray-200 text-[14px] font-medium text-[#4A5468] hover:border-[#C03221] hover:text-[#C03221] transition">
            Cancel
          </button>
          <button type="submit" name="decision" value="allow"
            className="flex-1 h-11 rounded-lg bg-brand text-white text-[14px] font-semibold hover:bg-brand-dark transition">
            Approve
          </button>
        </div>
      </form>

      <p className="text-[11.5px] text-[#A6ACBE] text-center mt-4">
        You&apos;ll be sent back to <b className="font-medium text-[#8A92A6]">{host}</b>.
        You can disconnect any time from System → Connectors.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="preview-scope min-h-screen bg-[#F6F7FB] flex items-center justify-center p-5">
      <div className="w-full max-w-[460px] bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center justify-center gap-2 mb-5">
          <span className="text-[13px] font-semibold text-[#232D42]">GooCampus</span>
          <span className="text-[13px] text-brand font-semibold">Marketing OS</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center">
      <h1 className="text-[17px] font-semibold text-[#232D42]">{title}</h1>
      <p className="text-[13.5px] text-[#8A92A6] mt-2">{body}</p>
      <a href="/dashboard/preview/connectors"
        className="inline-block mt-5 h-10 leading-10 px-4 rounded-lg border border-gray-200 text-[13.5px] font-medium text-[#4A5468] hover:border-brand hover:text-brand transition">
        Go to Connectors
      </a>
    </div>
  );
}

function Li({ yes, children }: { yes?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span className={`shrink-0 mt-[1px] font-bold ${yes ? "text-[#0F6E3C]" : "text-[#C03221]"}`}>{yes ? "✓" : "×"}</span>
      <span className={yes ? "text-[#3B4457]" : "text-[#8A92A6]"}>{children}</span>
    </li>
  );
}
