# Review Loop Packets (deprecated — see `packet-anatomy.md`)

This file used to hold standalone Fix Handoff Packet, Fix Completion Packet, and Re-review Output templates that agents passed by hand between sessions. As of v2.0.0 of this skill, all of these are H1 sections inside a single persistent packet file at `$repo_root/.review-handoff/active/<branch_slug>/<local_minute>-<scope_slug>.md`.

For the current templates:

- `# Fix Handoff` section schema — see `packet-anatomy.md` § "Section: # Fix Handoff"
- `# Fix Completion` section schema (with `Fix Conclusion` / `Original Findings Snapshot` rules) — see `packet-anatomy.md` § "Section: # Fix Completion"
- `# Re-review` section schema and verdict-to-lifecycle action — see `packet-anatomy.md` § "Section: # Re-review" and § "Lifecycle and Archive" in `SKILL.md`
- Multi-round `(round N)` suffix convention — see `packet-anatomy.md` § "Multi-round suffix"
- Frontmatter, addressing, naming, edge cases — see `packet-addressing.md`

Do not author packets against this stub; it exists only so old links don't 404.
