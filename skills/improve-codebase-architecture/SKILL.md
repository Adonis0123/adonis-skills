---
name: improve-codebase-architecture
description: "Scan a codebase for deepening opportunities and present them as a visual HTML report. Optionally grill a chosen candidate when companion skills are installed. Use when the user asks to improve architecture, deepen modules, find shallow modules, or run an architecture review report. Prefer explicit invocation; architecture-hardening-loop may call only the scan-and-report phase."
metadata:
  author: adonis
  version: "1.1.0"
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Public phases (dependency closure)

| Phase                              | Required? | Extra skills                                                              | Clean-env install of this skill alone           |
| ---------------------------------- | --------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| **1. Explore + HTML report**       | Always    | **None** — self-contained                                                 | Fully runnable                                  |
| **2. Grilling a chosen candidate** | Optional  | `grilling`, optionally `domain-modeling` / `codebase-design` if installed | Skip or stop after report if companions missing |

`architecture-hardening-loop` only invokes **phase 1**. Do not refuse phase 1 because optional companion skills are absent.

## Built-in design vocabulary (no external skill required)

Use these terms exactly in every suggestion — do not drift into vague "component," "service," or "API" labels when you mean the following:

| Term          | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| **module**    | A unit with a clear interface and implementation            |
| **interface** | What callers must know to use the module                    |
| **depth**     | Much behavior behind a small interface (deep = good)        |
| **shallow**   | Interface nearly as complex as the implementation           |
| **seam**      | A place you can change one side without rewriting the other |
| **adapter**   | Implementation behind a seam                                |
| **leverage**  | How many future changes one deepening pays for              |
| **locality**  | Related decisions live together; bugs not scattered         |

**Deletion test:** would deleting this unit concentrate complexity, or just move it? "Concentrates" supports a deepening candidate.

**Adapter rule of thumb:** one adapter = hypothetical seam; two real adapters = real seam.

If `codebase-design` is installed, you may read it for richer vocabulary — **optional**, never a gate for phase 1.

Domain language: prefer names from `CONTEXT.md` when present. ADRs in `docs/adr/` record decisions not to re-litigate without strong friction.

## Process

### 1. Explore (required, self-contained)

**Scope before you scan — YAGNI.** Deepening pays off on code that changes, so weight recently changed areas:

- If the user named a direction — a module, subsystem, or pain point — take it and skip hot-spot inference.
- Otherwise, walk a stretch of `git log --oneline` for hot spots; if changes are scattered, widen the net.

Read `CONTEXT.md` and nearby ADRs when they exist (skip if absent — do not fail).

Explore the codebase (subagent Explore when available). Note friction:

- Understanding one concept requires bouncing across many small modules
- Modules are **shallow**
- Pure functions extracted for tests while real bugs sit in call wiring (no **locality**)
- Tightly coupled modules leak across **seams**
- Hard-to-test surfaces through the current interface

Apply the **deletion test** to suspected shallow units.

### 2. Present candidates as an HTML report (required, self-contained)

Write a self-contained HTML file under the OS temp dir so nothing lands in the repo. Resolve `$TMPDIR`, else `/tmp` (or `%TEMP%` on Windows). Write `<tmpdir>/architecture-review-<timestamp>.html`. Open it for the user (`open` / `xdg-open` / `start`) and print the absolute path.

Use Tailwind via CDN and Mermaid via CDN where graph-shaped diagrams help. Each candidate gets a before/after visualisation.

For each candidate card:

- **Files** — modules involved
- **Problem** — current architectural friction
- **Solution** — plain English change
- **Benefits** — locality, leverage, testability
- **Before / After diagram**
- **Recommendation strength** — `Strong` | `Worth exploring` | `Speculative`

End with **Top recommendation**. Prefer domain terms from `CONTEXT.md` when available.

**ADR conflicts:** only surface candidates that contradict an ADR when friction is strong enough to reopen it; mark the card clearly.

See [HTML-REPORT.md](HTML-REPORT.md) for scaffold and styling.

Do **not** invent interfaces in the report. After the file is written:

- If this run is **scan-and-report only** (e.g. called by `architecture-hardening-loop`): stop here. Return the report path and candidate list. Do not ask the user to pick, and do not enter grilling.
- If this is a **standalone interactive** run: ask "Which of these would you like to explore?" then continue only if phase 2 companions allow.

### 3. Grilling loop (optional)

Only after the user picks a candidate **and** phase 2 is wanted:

1. If `grilling` is **not** installed: report that phase 1 is complete, list the chosen candidate, and state that interactive grilling requires installing `grilling` (and optionally `domain-modeling` / `codebase-design`). Do **not** invent a substitute grilling protocol and do not fail phase 1 retroactively.
2. If `grilling` is installed: run it for constraints, dependencies, deepened shape, seam contents, and surviving tests.
3. If `domain-modeling` is installed: keep `CONTEXT.md` current as names crystallize. If absent: apply obvious in-file naming updates only when the user already uses domain docs; otherwise skip.
4. If `codebase-design` is installed and the user wants alternative interfaces: use its design-it-twice pattern. If absent: skip.

Side effects when companions are present:

- New domain term → update `CONTEXT.md` (create lazily only if the project already uses that convention)
- Load-bearing rejection → offer an ADR when a future explorer would otherwise re-suggest the same idea
