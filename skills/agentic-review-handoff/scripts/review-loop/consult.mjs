/**
 * DecisionConsult — one-shot advisory peer consult (no Verdict machine).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot, ensureReviewHandoffLayout } from './repositories.mjs';
import { createAdapter, DELIVERY_UNKNOWN } from './adapters.mjs';

/**
 * @param {{
 *   repoRoot?: string,
 *   cwd?: string,
 *   peer: string,
 *   questionFile?: string,
 *   question?: string,
 *   adapterFactory?: Function,
 *   adapterOpts?: object,
 * }} opts
 */
export async function cmdConsult(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  ensureReviewHandoffLayout(repoRoot);
  const peer = String(opts.peer || opts.reviewer || '').toLowerCase();
  if (!['codex', 'grok', 'claude'].includes(peer)) {
    throw new Error('--peer must be codex|grok|claude');
  }

  let question = opts.question;
  if (opts.questionFile) {
    question = fs.readFileSync(opts.questionFile, 'utf8');
  }
  if (!question || !String(question).trim()) {
    throw new Error('--question-file or question required');
  }

  const framing = String(question).trim();
  const prompt = [
    'You are a decision consult peer (advisory only).',
    'The user retains final authority. Do not implement code. Do not claim consensus.',
    'Respond with: stance, key reasons, open risks, and what evidence would change your mind.',
    '',
    '--- question framing ---',
    framing,
  ].join('\n');

  const adapter = (opts.adapterFactory || createAdapter)(peer, {
    repoRoot,
    packetId: null,
    sessionStorePath: null,
    ...(opts.adapterOpts || {}),
  });

  const result = await adapter.newSession(prompt);
  if (!result.ok) {
    return {
      ok: false,
      status: DELIVERY_UNKNOWN,
      message: `consult peer invoke failed: ${result.error}`,
      error: result.error,
    };
  }

  const consultsDir = path.join(repoRoot, '.review-handoff', 'runtime', 'consults');
  fs.mkdirSync(consultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = peer;
  const outPath = path.join(consultsDir, `${ts}-${slug}.md`);
  const record = `# DecisionConsult

- peer: ${peer}
- advisory: true
- created: ${new Date().toISOString()}

## Question

${framing}

## Peer response

${result.text}
`;
  fs.writeFileSync(outPath, record, 'utf8');

  return {
    ok: true,
    status: 'advisory',
    peer,
    recordPath: outPath,
    text: result.text,
    message:
      'Consult complete (advisory). Do not auto-adopt unless user explicitly authorized "一致即采纳" for this turn.',
  };
}
