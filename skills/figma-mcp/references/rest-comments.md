# Figma comments over REST

The official Figma MCP has no comments tool. When a task needs design-review comments (for example "audit which resolved comments were applied in code"), read them from the REST endpoint with a personal access token (PAT) the user owns. Use the MCP only for the parts it is good at: `get_metadata` to scope the comments to a subtree, and `get_screenshot` to see what each pin points at. On a host without the MCP, use `figma_rest.py nodes` / `images` for the same two jobs.

## 1. Token

Comments always go through REST, on every host. Set up and guard the token as in [rest-fallback.md](rest-fallback.md#token): the PAT needs `file_comments:read`, lives in `FIGMA_MCP_API_KEY` (or `FIGMA_API_KEY`), and is checked for presence only. It is separate from the host's MCP OAuth grant, acts as the account that created it, and never proves MCP readiness. When it is unset, give the user those steps and stop; do not scrape the Figma UI unless asked.

## 2. Fetch and scope the threads

`GET https://api.figma.com/v1/files/:file_key/comments?as_md=true` with header `X-Figma-Token`. It returns every comment in the file (often over a thousand), flat: a root comment has no `parent_id`; replies carry the root's `id` in `parent_id`. `resolved_at` is set only on the root. `client_meta.node_id` is the node the pin sits on and `client_meta.node_offset` is the pin position in that node's coordinate space. The endpoint is rate-limit Tier 2, so fetch once per task and reuse the result.

Use the bundled script instead of hand-writing the grouping:

```bash
# 1) Save get_metadata for the section/frame the user linked (the MCP host
#    usually spills large results to a file; pass that file path directly).
#    Without the MCP, pass --scope-ids with ids collected from `nodes` output.
# 2) Group and filter:
python3 scripts/figma_rest.py comments <fileKey> \
  --metadata <saved-get_metadata-result> \
  --resolved only \
  --out threads.json
```

- `--metadata` keeps only comments whose `node_id` is in that subtree. It accepts raw XML or the MCP JSON array of `{type, text}` entries; the first entry is often just a "Currently selected nodes" preamble, which the script skips by reading every entry.
- `--resolved only|exclude|all` filters by root resolution. Report the open threads anyway when they matter; skipping them silently hides unresolved decisions.
- Output per thread: `order_id` (the `#1283` number shown in Figma), `node_id`, `node_offset`, author, `resolved`, `message`, and time-ordered `replies`. stderr prints `FIGMA_REST: N threads (R resolved, O open)`.
- Errors: 401 = token rejected, 403 = expired or missing `file_comments:read`, 404 = file not shared with the token's account.

## 3. Work out what each pin points at

A comment's text is often only the new wording ("Set as Cover"); the old wording lives in the design under the pin. Layer names in `get_metadata` are not reliable for this (many text layers are named `Title` or `2rd-level-title`), so look at pixels:

1. `get_screenshot` on the pin's `node_id` with `maxDimension` at least the node's larger side, so screenshot pixels equal canvas units (without the MCP: `figma_rest.py images <fileKey> --ids <node_id> --scale 1`).
2. Download it and crop around `node_offset` (for example a 400×260 box centred on it; macOS: `sips -c <h> <w> --cropOffset <y> <x> in.png --out crop.png`). Read the crop.
3. When the pin lands on a sticky note or a label outside the UI (for example a state annotation such as "默认"), say it annotates the design, not UI copy, instead of inventing a target.

## 4. Decide the final wording from the thread

Read the whole thread, not just the root. Common conventions in review threads:

- A bare approval reply ("1", "+1", "ok", "👍") accepts the root text as written.
- A reply that states different wording overrides the root; the last agreed wording wins (e.g. root "Select a Frame", reply "Pick a Frame" → final "Pick a Frame").
- A root with an explanation plus a proposal ("… consider Delete This Version") resolves to the proposal once a reply agrees.

Keep the thread number (`#1245`) next to each decision so reviewers can trace it. When one thread is ambiguous about its target or wording, list it as needing a decision rather than guessing.

## 5. Hand-off to code audits

For a "which comments were applied" audit, give each code-searching agent its slice of `threads.json` (final wording, old wording from the crop, `node_id`) and ask for `ALREADY_MATCHES / NEEDS_CHANGE / NOT_FOUND / AMBIGUOUS` with file and line. Let one agent apply edits so parallel agents do not collide on shared files.
