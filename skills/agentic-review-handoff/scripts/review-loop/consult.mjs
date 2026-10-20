/**
 * DecisionConsult — advisory peer consult (no Verdict machine).
 * `resume` continues a recorded consult in the same peer session, so a caller
 * can hold a multi-round conversation with one peer (e.g. a grill Proxy).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveRepoRoot, ensureReviewHandoffLayout } from "./repositories.mjs";
import {
  createAdapter,
  DELIVERY_UNKNOWN,
  parseFallback,
  PRODUCTS,
} from "./adapters.mjs";
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
 *   resume?: string|null,
 *   raw?: boolean,
 *   web?: boolean,
 *   adapterFactory?: Function,
 *   adapterOpts?: object,
 * }} opts
 */
export async function cmdConsult(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  ensureReviewHandoffLayout(repoRoot);
  const prior = opts.resume ? loadConsult(opts.resume) : null;
  let peer = String(opts.peer || opts.reviewer || "").toLowerCase();
  if (prior) {
    // A resumed consult keeps its own peer and launcher: the session lives there.
    if (peer && peer !== prior.product) {
      throw new Error(
        `--resume belongs to ${prior.product}; drop --peer or pass --peer=${prior.product}`,
      );
    }
    peer = prior.product;
  }
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
  if (!PRODUCTS.includes(peer)) {
    throw new Error(
      `--peer must be ${PRODUCTS.join("|")}, or pass --host=<your product> to use the saved preference`,
    );
  }
  let peerCommand = prior ? prior.command : (opts.peerCommand ?? null);
  const fallback = parseFallback(fallbackRaw, peer);

  let question = opts.question;
  if (opts.questionFile) {
    question = fs.readFileSync(opts.questionFile, "utf8");
  }
  if (!question || !String(question).trim()) {
    throw new Error("--question-file or question required");
  }

  const framing = String(question).trim();
  // --raw: the caller's file is the whole prompt (it brings its own role and answer format).
  const prompt = opts.raw
    ? framing
    : [
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
      ...(opts.web ? { web: true } : {}),
      ...(opts.adapterOpts || {}),
    });

  let result = prior
    ? await makeAdapter(peer, peerCommand).resume(prior.sessionId, prompt)
    : await makeAdapter(peer, peerCommand).newSession(prompt);
  // A peer that timed out answered nothing: ask the next product in --fallback the same question.
  // On a resumed consult the new product starts without the earlier rounds (contextLost).
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

  const contextLost = Boolean(prior && (fallbacks.length || result.degraded));
  let outPath;
  let round = 1;
  if (prior) {
    // Append the follow-up to the same record so one file holds the whole conversation.
    outPath = prior.recordPath;
    round = prior.round + 1;
    fs.appendFileSync(
      outPath,
      `
## Follow-up ${round}${peer !== prior.product ? ` (fallback to ${peer})` : ""}${contextLost ? " (new session, earlier rounds not visible to peer)" : ""}

${framing}

## Peer response ${round}

${result.text}
`,
      "utf8",
    );
  } else {
    const consultsDir = path.join(
      repoRoot,
      ".review-handoff",
      "runtime",
      "consults",
    );
    fs.mkdirSync(consultsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    outPath = path.join(consultsDir, `${ts}-${peer}.md`);
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
  }
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
          round,
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
    round,
    ...(prior ? { resumed: true, contextLost } : {}),
    ...(fallbacks.length ? { fallbacks } : {}),
    text: result.text,
    message:
      'Consult complete (advisory). Do not auto-adopt unless user explicitly authorized "一致即采纳" for this turn.',
  };
}

/**
 * Reads a consult record (`.md`) or its `.session.json` sidecar for --resume.
 * @param {string} ref
 */
function loadConsult(ref) {
  const recordPath = String(ref).replace(/\.session\.json$/, ".md");
  const sidecar = recordPath.replace(/\.md$/, ".session.json");
  if (!fs.existsSync(recordPath) || !fs.existsSync(sidecar)) {
    throw new Error(
      `--resume needs a consult record and its .session.json sidecar: ${recordPath}`,
    );
  }
  const data = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  if (!data.sessionId || !PRODUCTS.includes(data.product)) {
    throw new Error(`consult sidecar has no resumable session: ${sidecar}`);
  }
  return {
    recordPath,
    product: data.product,
    command: data.command ?? null,
    sessionId: data.sessionId,
    round: Number.isInteger(data.round) ? data.round : 1,
  };
}
