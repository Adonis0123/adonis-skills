/**
 * `review-loop sessions` — list recorded reviewer channel sessions and print
 * copy-ready resume commands per product (codex / grok / claude).
 *
 * Read-only: scans `.review-handoff/runtime/<branch>/<packet>/reviewer-session.json`
 * written by the adapter bookkeeping (T1). Command forms verified 2026-07-22:
 *   codex  interactive `codex resume <id>` / headless `codex exec resume <id> "<prompt>"`
 *   claude interactive `claude --resume <id>` / headless `claude -p --resume <id> "<prompt>"`
 *   grok   interactive `grok -r <id>` / headless `grok -r <id> -p "<prompt>"`
 * Note: Codex Desktop's session list hides `codex_exec`-originated sessions —
 * the resume commands below are the reliable way back in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from './repositories.mjs';

const PROMPT_PLACEHOLDER = '<prompt>';

const RESUME_FORMS = {
  codex: (id) => ({
    interactive: `codex resume ${id}`,
    headless: `codex exec resume ${id} "${PROMPT_PLACEHOLDER}"`,
  }),
  claude: (id) => ({
    interactive: `claude --resume ${id}`,
    headless: `claude -p --resume ${id} "${PROMPT_PLACEHOLDER}"`,
  }),
  grok: (id) => ({
    interactive: `grok -r ${id}`,
    headless: `grok -r ${id} -p "${PROMPT_PLACEHOLDER}"`,
  }),
};

/**
 * @param {{ cwd?: string, repoRoot?: string, product?: string }} opts
 */
export function cmdSessions(opts = {}) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  const runtimeDir = path.join(repoRoot, '.review-handoff', 'runtime');
  /** @type {Array<Record<string, unknown>>} */
  const sessions = [];

  if (fs.existsSync(runtimeDir)) {
    for (const branch of fs.readdirSync(runtimeDir, { withFileTypes: true })) {
      if (!branch.isDirectory() || branch.name === 'consults') continue;
      const branchDir = path.join(runtimeDir, branch.name);
      for (const packet of fs.readdirSync(branchDir, { withFileTypes: true })) {
        if (!packet.isDirectory()) continue;
        const file = path.join(branchDir, packet.name, 'reviewer-session.json');
        if (!fs.existsSync(file)) continue;
        let record;
        try {
          record = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
          continue; // unreadable bookkeeping is not this command's failure
        }
        const { product, sessionId, updated } = record ?? {};
        if (!product || !sessionId) continue;
        if (opts.product && opts.product !== product) continue;
        const forms = RESUME_FORMS[product];
        sessions.push({
          packetId: `${branch.name}/${packet.name}`,
          product,
          sessionId,
          updated: updated ?? null,
          resume: forms
            ? forms(sessionId)
            : { interactive: null, headless: null, note: `unknown product "${product}"` },
        });
      }
    }
  }

  sessions.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));

  return {
    ok: true,
    repoRoot,
    count: sessions.length,
    sessions,
    note:
      sessions.length === 0
        ? 'No reviewer sessions recorded yet (run an auto loop first)'
        : `Replace ${PROMPT_PLACEHOLDER} with your follow-up question for headless form`,
  };
}
