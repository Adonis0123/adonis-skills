/**
 * DecisionConsult — one-shot advisory peer consult (no Verdict machine).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoRoot, ensureReviewHandoffLayout } from "./repositories.mjs";
import { createAdapter, DELIVERY_UNKNOWN, parseFallback } from "./adapters.mjs";
import { resolveFromPrefs } from "./prefs.mjs";

/**
 * @param {{
 *   repoRoot?: string,
 *   cwd?: string,
 *   peer: string,
 *   peerCommand?: string|null,
 *   fallback?: string|string[]|null,
 *   questionFile?: string,
 *   question?: string,
 *   adapterFactory?: Function,
 *   adapterOpts?: object,
 * }} opts
 */
export async function cmdConsult(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  ensureReviewHandoffLayout(repoRoot);
  let peer = String(opts.peer || opts.reviewer || "").toLowerCase();
  let fallbackRaw = opts.fallback;
  // No peer named: the saved Reviewer preference picks it and the timeout fallbacks (review-loop prefs).
  if (!peer && opts.host) {
    const picked = resolveFromPrefs({
      host: opts.host,
      env: opts.env ?? process.env,
      forceSkipHost: opts.skipHost === true,
    });
    peer = picked.reviewer;
    fallbackRaw = fallbackRaw ?? picked.fallback;
  }
  if (!["codex", "grok", "claude"].includes(peer)) {
    throw new Error(
      "--peer must be codex|grok|claude, or pass --host=<your product> to use the saved preference",
    );
  }
  let peerCommand = opts.peerCommand ?? null;
  const fallback = parseFallback(fallbackRaw, peer);

  let question = opts.question;
  if (opts.questionFile) {
    question = fs.readFileSync(opts.questionFile, "utf8");
  }
  if (!question || !String(question).trim()) {
    throw new Error("--question-file or question required");
  }

  const framing = String(question).trim();
  const prompt = [
    "You are a decision consult peer (advisory only).",
    "The user retains final authority. Do not implement code. Do not claim consensus.",
    "Respond with: stance, key reasons, open risks, and what evidence would change your mind.",
    "",
    "--- question framing ---",
    framing,
  ].join("\n");

  const makeAdapter = (product, command) =>
    (opts.adapterFactory || createAdapter)(product, {
      repoRoot,
      packetId: null,
      sessionStorePath: null,
      command,
      ...(opts.adapterOpts || {}),
    });

  let result = await makeAdapter(peer, peerCommand).newSession(prompt);
  // A peer that timed out answered nothing: ask the next product in --fallback the same question.
  /** @type {{ from: string, to: string, reason: string }[]} */
  const fallbacks = [];
  for (const next of fallback) {
    if (result.ok || result.timedOut !== true) break;
    fallbacks.push({ from: peer, to: next, reason: result.error });
    peer = next;
    peerCommand = null;
    result = await makeAdapter(peer, null).newSession(prompt);
  }
  if (!result.ok) {
    return {
      ok: false,
      status: DELIVERY_UNKNOWN,
      message: `consult peer invoke failed: ${result.error}`,
      error: result.error,
      ...(fallbacks.length ? { fallbacks } : {}),
    };
  }

  const consultsDir = path.join(
    repoRoot,
    ".review-handoff",
    "runtime",
    "consults",
  );
  fs.mkdirSync(consultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = peer;
  const outPath = path.join(consultsDir, `${ts}-${slug}.md`);
  const record = `# DecisionConsult

- peer: ${peer}${peerCommand ? `\n- command: ${peerCommand}` : ""}
- advisory: true
- created: ${new Date().toISOString()}

## Question

${framing}

## Peer response

${result.text}
`;
  fs.writeFileSync(outPath, record, "utf8");
  // Sidecar lets `review-loop sessions` list consult handles next to packet reviewers.
  const sessionId = result.sessionId ?? null;
  if (sessionId) {
    fs.writeFileSync(
      outPath.replace(/\.md$/, ".session.json"),
      `${JSON.stringify(
        {
          product: peer,
          ...(peerCommand ? { command: peerCommand } : {}),
          sessionId,
          updated: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return {
    ok: true,
    status: "advisory",
    peer,
    ...(peerCommand ? { peerCommand } : {}),
    recordPath: outPath,
    sessionId,
    ...(fallbacks.length ? { fallbacks } : {}),
    text: result.text,
    message:
      'Consult complete (advisory). Do not auto-adopt unless user explicitly authorized "一致即采纳" for this turn.',
  };
}
