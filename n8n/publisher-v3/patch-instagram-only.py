"""Patch the IG/FB Publisher v3 code nodes for Instagram-only brands (5 Nov 2026).

Two changes, in both "Publish (at the time)" and "Prepare (send ahead)":
1. Load Brand Pages: a brand saved without a Facebook page (Connect Instagram only:
   pageId "", key starts "IG") is now registered — before, it was skipped, and its
   page name ("@goocampusindia") then fell through to the "india" keyword → 12thPlus.
   Its destination is its own Instagram, with no Facebook pages.
2. Instagram calls use the account's own address: an Instagram-login key ("IG…")
   only works on graph.instagram.com; Page keys keep graph.facebook.com.
Everything else is byte-for-byte the live code.
"""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
wf = json.load(open(src))

OLD_LINKED = "if (!t.token || !n.pageId || !n.pageName) continue; const key = String(n.pageName).toLowerCase(); if (!pageByName[key]) pageByName[key] = { id: n.pageId, name: n.pageName, access_token: t.token }; const u = String(n.igUsername || '').toLowerCase(); if (u && n.igUserId && !igByUser[u]) igByUser[u] = { igUserId: n.igUserId, token: t.token }; linkedByName[key] = { igUser: u, fbPages: [key] }; }"
NEW_LINKED = ("if (!t.token || !n.pageName) continue; const key = String(n.pageName).toLowerCase(); "
              "if (n.pageId && !pageByName[key]) pageByName[key] = { id: n.pageId, name: n.pageName, access_token: t.token }; "
              "const u = String(n.igUsername || '').toLowerCase(); "
              "if (u && n.igUserId && !igByUser[u]) igByUser[u] = { igUserId: n.igUserId, token: t.token, api: String(t.token).indexOf('IG') === 0 ? IGGRAPH : GRAPH }; "
              "linkedByName[key] = { igUser: u, fbPages: n.pageId ? [key] : [] }; }")
# IGGRAPH must exist before the loop above runs; GRAPH is declared after destFor, so
# hoist both to the top of the script.
HEAD = "// Instagram-only brands (5 Nov): an Instagram-login key (IG…) only works on graph.instagram.com.\nconst GRAPH = 'https://graph.facebook.com/v23.0';\nconst IGGRAPH = 'https://graph.instagram.com/v23.0';\n"

def patch(code, ig_start, ig_end):
    assert code.count(OLD_LINKED) == 1, "linked-brands line not found exactly once"
    code = code.replace(OLD_LINKED, NEW_LINKED)
    assert code.count("const GRAPH = 'https://graph.facebook.com/v23.0';\n") == 1
    code = code.replace("const GRAPH = 'https://graph.facebook.com/v23.0';\n", "", 1)
    code = HEAD + code
    # Inside the Instagram block only: GRAPH → the account's own address.
    a = code.index(ig_start); b = code.index(ig_end, a)
    block = code[a:b]
    n = block.count("GRAPH + ")
    block = block.replace("const ig = igAcc.igUserId, tok = igAcc.token;", "const ig = igAcc.igUserId, tok = igAcc.token, G = igAcc.api || GRAPH;", 1)
    block = block.replace("GRAPH + ", "G + ")
    assert "G = igAcc.api || GRAPH" in block and n > 0
    return code[:a] + block + code[b:], n

for node in wf["nodes"]:
    if node["name"] == "Publish (at the time)":
        node["parameters"]["jsCode"], n = patch(node["parameters"]["jsCode"], "if (igAcc) {", "if (cust.ig_url_done && cust.ig_url_done !== 'published')")
        print("Publish: Instagram calls switched:", n)
    if node["name"] == "Prepare (send ahead)":
        node["parameters"]["jsCode"], n = patch(node["parameters"]["jsCode"], "if (igAcc) {", "// ── Facebook ──")
        print("Prepare: Instagram calls switched:", n)
json.dump(wf, open(dst, "w"))
