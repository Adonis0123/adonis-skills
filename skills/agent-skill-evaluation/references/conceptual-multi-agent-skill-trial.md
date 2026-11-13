# Conceptual multi-agent skill trials

Use when option **C** targets a skill whose value is _orchestration patterns / multi-agent taxonomy_, not a host-native tool path.

## Recognition signals

- SKILL.md centers sequential / parallel / hierarchical / consensus diagrams
- Ships `examples/*.py` + `scripts/*` but agents return fixed strings (no model/tool calls)
- “Framework support” is dict/dataclass templates (CrewAI, AutoGen, LangGraph, Swarm) without runnable deps
- Marketing: sophisticated multi-agent systems, production-ready, framework-agnostic

## Exercise checklist (temp clone only)

1. `git clone --depth 1` → `/tmp/<name>-eval` — never write enabled skill dirs.
2. Import and run pattern classes with correct constructors (read signatures; hierarchical often needs `Dict[team, List[agent]]`, consensus needs a mediator).
3. Run utilities: message broker, workflow deps / critical path, simple benchmarks.
4. Check demos: `python examples/*.py` exit 0 **and** whether `__main__` prints anything. Silent success ≠ exercised.
5. Classify each surface:

| Surface               | Stub            | Real                                 |
| --------------------- | --------------- | ------------------------------------ |
| Pattern orchestrators | string `work()` | LLM/tool agents                      |
| Framework files       | template dicts  | importable framework runs            |
| Host multi-agent      | N/A             | host delegate tool, spawn CLI agents |

6. Dual-track map against host stack before A/B/C:

| Host capability (example)                  | Job                               |
| ------------------------------------------ | --------------------------------- |
| host delegate tool (e.g. `delegate_task`)  | real subagents, batch, background |
| `claude-code` / `codex` / `opencode`       | external agent delegation         |
| loop skills (`task-completion-loop`, etc.) | bounded multi-step orchestration  |

## Decision bar

- **A full package** (e.g. `qodex-ai/ai-agent-skills` ~80 skills): almost never — selection tax + dual-track.
- **B keep current**: default when host already runs real multi-agent work.
- **C permanent single skill**: only if a real task needs the _patterns as code_ and mental load ≤ host path. Teaching/checklist alone → **no install**.

Install counts (skills.sh `userInteractionCount`) are discovery only.

## Baseline: qodex-ai multi-agent-orchestration (2026-08-04)

| Fact                             | Detail                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| URL                              | https://www.skills.sh/qodex-ai/ai-agent-skills/multi-agent-orchestration       |
| Installs (ld+json)               | 1957 at trial                                                                  |
| Temp path                        | `/tmp/multi-agent-orch-eval`                                                   |
| Patterns exercised               | sequential, parallel, hierarchical, consensus, DAG, adaptive — all stub agents |
| Utilities                        | broker / workflow / effectiveness metrics OK in-process                        |
| Examples CLI                     | exit 0, **no `__main__` demos**                                                |
| Frameworks                       | templates only                                                                 |
| Host multi-agent integration     | none (no Claude/Codex/Grok subagents, no host delegate tool)                   |
| Peer review (daily coding scope) | Claude **C**; Codex **B**; Grok **B** — consensus: do not permanent-install    |
| Decision                         | **B**; permanent install not recommended; package-wide A no                    |

Re-trial only if host lacks multi-agent execution _and_ a task needs reusable pattern code beyond native subagents / host delegate tools.

## Cleanup

```bash
rm -rf /tmp/multi-agent-orch-eval
# do not uninstall unrelated adopted skills
```
