#!/usr/bin/env python3
"""Read-only Figma REST helper for when the official MCP cannot serve a read.

Token: $FIGMA_MCP_API_KEY, else $FIGMA_API_KEY (the name Framelink-based
setups use); --token-env overrides. The token only travels in the
X-Figma-Token header. It is never printed, written to disk, or put on a
command line, which is why this script exists instead of curl one-liners.

Subcommands:
  comments <fileKey> [--metadata FILE | --scope-ids FILE] [--resolved only|exclude|all]
      Group comments into threads; --metadata (a saved get_metadata result,
      raw XML or the MCP {type,text} JSON array) keeps only pins in that subtree.
  nodes <fileKey> --ids 1:2,3:4 [--depth N]
      Node JSON (layout, styles, text) for the given ids. Use --depth to keep
      output small; full frames can be megabytes.
  images <fileKey> --ids 1:2,3:4 [--format png|jpg|svg|pdf] [--scale S]
      Render nodes and print {id: url}. URLs expire; download promptly.

Every subcommand takes --out FILE; a one-line summary goes to stderr.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.figma.com/v1"
HINTS = {
    400: "bad request; check node ids use 1:2 form",
    401: "token rejected; regenerate it and re-export the env var",
    403: "token expired, missing a scope (file_content:read / file_comments:read), or the file is not shared with the token's account",
    404: "file not found or not shared with the token's account",
    429: "rate limited; View/Collab seats have monthly caps on file/image reads",
}


def token_for(args):
    names = [args.token_env] if args.token_env else ["FIGMA_MCP_API_KEY", "FIGMA_API_KEY"]
    token = next((os.environ[n] for n in names if os.environ.get(n)), None)
    if not token:
        sys.exit(f"FIGMA_REST: none of {', '.join('$' + n for n in names)} is set; see references/rest-fallback.md")
    return token


def get(path, params, token):
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"X-Figma-Token": token})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as err:
        sys.exit(f"FIGMA_REST: HTTP {err.code} ({HINTS.get(err.code, 'unexpected response')})")


def load_scope(args):
    if args.scope_ids:
        with open(args.scope_ids, encoding="utf-8") as fh:
            return set(fh.read().split())
    if not args.metadata:
        return None
    with open(args.metadata, encoding="utf-8") as fh:
        raw = fh.read()
    try:
        entries = json.loads(raw)
        raw = "\n".join(e.get("text", "") for e in entries if isinstance(e, dict))
    except (json.JSONDecodeError, AttributeError):
        pass
    return set(re.findall(r'\sid="([^"]+)"', raw))


def cmd_comments(args, token):
    comments = get(f"/files/{args.file_key}/comments", {"as_md": "true"}, token)["comments"]
    scope = load_scope(args)
    replies = {}
    for c in comments:
        if c.get("parent_id"):
            replies.setdefault(c["parent_id"], []).append(c)
    threads = []
    for c in comments:
        if c.get("parent_id"):
            continue
        meta = c.get("client_meta") or {}
        if scope is not None and meta.get("node_id") not in scope:
            continue
        resolved = bool(c.get("resolved_at"))
        if (args.resolved == "only" and not resolved) or (args.resolved == "exclude" and resolved):
            continue
        thread = sorted(replies.get(c["id"], []), key=lambda r: r["created_at"])
        threads.append({
            "order_id": c.get("order_id"),
            "node_id": meta.get("node_id"),
            "node_offset": meta.get("node_offset"),
            "user": c["user"]["handle"],
            "created_at": c["created_at"],
            "resolved": resolved,
            "message": c["message"],
            "replies": [{"user": r["user"]["handle"], "message": r["message"]} for r in thread],
        })
    threads.sort(key=lambda t: int(t["order_id"] or 0))
    done = sum(t["resolved"] for t in threads)
    return threads, f"{len(threads)} threads ({done} resolved, {len(threads) - done} open)"


def cmd_nodes(args, token):
    data = get(f"/files/{args.file_key}/nodes", {"ids": args.ids, "depth": args.depth}, token)
    nodes = data.get("nodes") or {}
    missing = [k for k, v in nodes.items() if v is None]
    return data, f"{len(nodes) - len(missing)} nodes" + (f", missing: {','.join(missing)}" if missing else "")


def cmd_images(args, token):
    data = get(f"/images/{args.file_key}", {"ids": args.ids, "format": args.format, "scale": args.scale}, token)
    if data.get("err"):
        sys.exit(f"FIGMA_REST: render failed ({data['err']})")
    images = data.get("images") or {}
    failed = [k for k, v in images.items() if not v]
    return images, f"{len(images) - len(failed)} renders" + (f", failed: {','.join(failed)}" if failed else "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--token-env")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("comments")
    p.add_argument("file_key")
    p.add_argument("--metadata")
    p.add_argument("--scope-ids")
    p.add_argument("--resolved", choices=["only", "exclude", "all"], default="all")

    p = sub.add_parser("nodes")
    p.add_argument("file_key")
    p.add_argument("--ids", required=True)
    p.add_argument("--depth", type=int)

    p = sub.add_parser("images")
    p.add_argument("file_key")
    p.add_argument("--ids", required=True)
    p.add_argument("--format", choices=["png", "jpg", "svg", "pdf"], default="png")
    p.add_argument("--scale", type=float, default=1)

    for p in sub.choices.values():
        p.add_argument("--out")

    args = ap.parse_args()
    if getattr(args, "ids", None):
        args.ids = args.ids.replace("-", ":")
    token = token_for(args)
    result, summary = {"comments": cmd_comments, "nodes": cmd_nodes, "images": cmd_images}[args.cmd](args, token)

    payload = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(payload)
    else:
        print(payload)
    print(f"FIGMA_REST: {summary}", file=sys.stderr)


if __name__ == "__main__":
    main()
