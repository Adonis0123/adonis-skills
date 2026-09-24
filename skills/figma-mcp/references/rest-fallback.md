# REST fallback

The official MCP is the default for every Figma read. The public REST API (`api.figma.com`, personal access token) can serve some reads when the MCP cannot, but it returns less (raw node JSON and renders, no reference code, no Code Connect), runs under a long-lived token instead of the host's OAuth grant, and hides MCP failures that should be fixed. Use it only on the branches below, say so before the first call, and never for writes.

## When to fall back

Decide from why the MCP cannot serve the read, not from the fact that a call failed.

| Why the MCP cannot serve it                                                             | Action                                                                                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Host is not in the MCP Catalog (pi, Hermes, WorkBuddy, ...)                             | REST for read-only design data                                                                                                         |
| The task needs comments (MCP has no comments tool)                                      | REST, see [rest-comments.md](rest-comments.md)                                                                                         |
| Tools missing, server not registered, OAuth expired or required                         | Recover the MCP by layer (SKILL.md). Do not fall back: the next task would hit the same break                                          |
| 403/404 from a Figma read                                                               | Stop with `FILE_ACCESS: UNVERIFIED`. The PAT may belong to another account, so a REST success would not prove this account's access    |
| A named account was requested                                                           | Stay on MCP. REST cannot satisfy the identity check                                                                                    |
| MCP read quota or rate limit hit                                                        | REST only if the user agrees and holds a Dev/Full seat; View/Collab seats are capped on REST too (file/image reads about 20 per month) |
| Writes, `use_figma`, Code Connect, `search_design_system`, `get_design_context` quality | No REST substitute. Report the MCP gap                                                                                                 |

When no row fits, recover the MCP instead.

## Declare it

Before the first REST call, tell the user in one line, then keep it in the status report:

- `Proof call: REST (not MCP)`. A REST success never counts as MCP readiness, so do not emit `FIGMA_MCP_READY` from it.
- `Account: PAT owner`. The token acts as whoever created it, which may not be the MCP account.
- What is lost for this task, e.g. "no reference code or Code Connect; layout comes from raw node JSON".

## Token

The PAT is the user's own credential. The agent never creates, prints, stores, or pastes it.

1. Figma → account menu (top-left of the file browser) → **Settings** → **Security** → **Personal access tokens** → **Generate new token**.
2. Set an expiration and grant read scopes only: **`file_content:read`** (nodes, renders) and **`file_comments:read`** (comments). Scopes are fixed at creation; a missing scope means a new token.
3. Export it where the host reads its environment: `FIGMA_MCP_API_KEY` in the user's shell profile, or `FIGMA_API_KEY` in the host's own env file. `FIGMA_API_KEY` is the name Framelink `figma-developer-mcp` expects, and some hosts clear inherited credentials at launch, so their env file is the one that counts.

Agent rules: check presence only (`[ -n "$FIGMA_MCP_API_KEY$FIGMA_API_KEY" ] && echo set`). Compare two variables by hash (`printf %s "$A" | shasum -a 256`) and report only same/different. When neither is set, give the user the steps above and stop.

## Calls

Use the bundled script; it keeps the token in the request header and off the command line and process list.

```bash
# Node JSON: layout, styles, text. Keep --depth small; whole frames can be megabytes.
python3 scripts/figma_rest.py nodes <fileKey> --ids 1:2 --depth 2 --out node.json

# Render nodes, then download the returned URLs promptly (they expire).
python3 scripts/figma_rest.py images <fileKey> --ids 1:2,3:4 --format png --scale 2 --out renders.json

# Comments grouped into threads, scoped to a subtree.
python3 scripts/figma_rest.py comments <fileKey> --metadata <saved-metadata> --resolved only --out threads.json
```

- Node ids accept `1:2` or the URL form `1-2`. Branch URLs use `branchKey` as `fileKey`, as on the MCP path.
- Renders are slow (a cold render of a single small frame took about 12 s); render one frame at a time instead of a whole page.
- Errors: 401 token rejected; 403 expired token, missing scope, or file not shared with the PAT's account; 404 file not found; 429 rate limited.

A host that needs these reads often can register a REST-backed MCP server instead, e.g. Framelink `figma-developer-mcp` pinned to a version with `get_figma_data` / `download_figma_images`. It is a community project, not Figma's; pin the version, disable its telemetry, and stop it from loading a project `.env` that could override the token. It has no comments tool, so comments still go through the script.
