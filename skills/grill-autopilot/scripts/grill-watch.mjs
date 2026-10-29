#!/usr/bin/env node
/**
 * grill-watch — a read-only live page for one grill-autopilot run.
 *
 *   node grill-watch.mjs start --run=<dir> --topic=<topic> --interviewer=<seat> --proxy=<seat> [--redteam=<seat>|none] [--no-open] [--port=<n>]
 *   node grill-watch.mjs event --run=<dir> --kind=done|fallback|failed|note [--text=<one line>]
 *   node grill-watch.mjs stop --run=<dir>
 *
 * A seat is `<product>:<account>` (`codex:codex003`) or a launcher name the
 * product is read from (`cc008`, `grok002`). The page shows the session as a
 * chat and derives every message from files the host already writes under the
 * run directory, so watching costs the host no tokens: `start` prints one line,
 * `event` prints nothing, and the server (127.0.0.1 only, detached) exits on
 * its own once the run is done or quiet.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAX_ROUNDS, parseAnswers } from "./grill-ledger.mjs";

const SELF = fileURLToPath(import.meta.url);
const PAGE = path.join(path.dirname(SELF), "..", "assets", "watch.html");
const PRODUCTS = ["claude", "codex", "grok", "pi"];
const WATCHED =
  /^(watch\.json|ledger\.json|events\.jsonl|round-\d+\.md|answers-\d+(?:-retry)?\.md|gate-\d+(?:-retry)?\.json|reask-\d+\.md|proxy-\d+\.log|redteam(?:-question)?\.md)$/;
const MAX_FILE_BYTES = 2_000_000;
const POLL_MS = 700;
const QUIET_MS = 45 * 60_000;
const AFTER_DONE_MS = 15 * 60_000;
const MAX_LIFE_MS = 4 * 3_600_000;

/** @param {string} name launcher or account name */
export function productOf(name) {
  const n = String(name ?? "").toLowerCase();
  if (/^(cc|claude)/.test(n)) return "claude";
  if (n.startsWith("codex")) return "codex";
  if (n.startsWith("grok")) return "grok";
  if (/^pi(?:$|[-_\d])/.test(n)) return "pi";
  return "unknown";
}

/**
 * @param {unknown} value `<product>:<account>`, a launcher name, a product, or `none`
 * @returns {{ product: string, account: string|null } | null}
 */
export function parseSeat(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v.toLowerCase() === "none") return null;
  const colon = v.indexOf(":");
  const head = colon === -1 ? null : v.slice(0, colon).toLowerCase();
  const account = colon === -1 ? v : v.slice(colon + 1) || null;
  const product = head ?? productOf(account);
  return {
    product: PRODUCTS.includes(product) ? product : "unknown",
    account: account && account.toLowerCase() !== product ? account : null,
  };
}

// Fenced blocks (the Proxy brief's answer-format example) are not questions.
function withoutFences(text) {
  let fenced = false;
  return String(text ?? "")
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    });
}

const Q_HEAD =
  /^\s*(?:#{1,4}\s*)?(?:❓\s*)?(?:\*\*)?\s*(Q\d+)\s*(?:\*\*)?\s*(?:[-–—:.：]\s*)?(.*)$/u;
const RECOMMEND =
  /^\s*(?:➡️|➡|→|->|\*{0,2}(?:recommended(?: answer)?|recommendation|推荐(?:答案)?)\*{0,2}\s*[:：])\s*(.*)$/iu;

function splitTitle(rest) {
  const bold = rest.match(/^\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/);
  if (bold) return { title: bold[1].trim(), body: bold[2].trim() };
  const colon = rest.search(/[:：]\s/);
  if (colon > 0 && colon <= 80)
    return {
      title: rest.slice(0, colon).trim(),
      body: rest.slice(colon + 1).trim(),
    };
  return { title: rest.trim(), body: "" };
}

/**
 * Reads Interviewer questions in grilling's round format
 * (`❓ **Q1** - **title**: body` … `➡️ recommendation`) or as `### Q1` headings.
 * @param {string} text
 * @returns {{ id: string, title: string, body: string, recommendation: string }[]}
 */
export function parseQuestions(text) {
  const out = [];
  let current = null;
  let inRecommendation = false;
  for (const line of withoutFences(text)) {
    const head = line.match(Q_HEAD);
    if (head) {
      const id = head[1].toUpperCase();
      current = out.some((q) => q.id === id)
        ? null
        : { id, ...splitTitle(head[2]), recommendation: "" };
      if (current) out.push(current);
      inRecommendation = false;
      continue;
    }
    if (!current) continue;
    if (/^#{1,3}\s/.test(line)) {
      current = null;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    const rec = line.match(RECOMMEND);
    if (rec) {
      current.recommendation = rec[1].trim();
      inRecommendation = true;
      continue;
    }
    const key = inRecommendation ? "recommendation" : "body";
    current[key] = current[key] ? `${current[key]}\n${line}` : line.trimStart();
  }
  for (const q of out) {
    q.body = q.body.trim();
    q.recommendation = q.recommendation.trim();
  }
  return out;
}

/** The plan section of the round-1 Proxy brief, if present. */
export function extractPlan(text) {
  const m = String(text ?? "").match(
    /^##\s+The plan\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m,
  );
  return m ? m[1].trim() : "";
}

/**
 * Red-team replies: one `hold` or `overturn: <why>` per question id.
 * @returns {{ id: string, verdict: 'hold'|'overturn', why: string }[]}
 */
export function parseVerdicts(text) {
  const out = [];
  for (const line of withoutFences(text)) {
    const m = line.match(/\b(Q\d+)\b.*?\b(hold|overturn)\b\s*[:：-]?\s*(.*)$/i);
    if (m && !out.some((v) => v.id === m[1].toUpperCase()))
      out.push({
        id: m[1].toUpperCase(),
        verdict: m[2].toLowerCase(),
        why: m[3].trim(),
      });
  }
  return out;
}

/** Last review-loop heartbeat in a consult stderr log. */
export function parseHeartbeat(text) {
  const lines = String(text ?? "")
    .split("\n")
    .filter((l) => l.includes("[review-loop]"));
  const last = lines.at(-1);
  if (!last) return null;
  return {
    product: last.match(/reviewer=(\S+)/)?.[1] ?? null,
    status: last.match(/status=(\S+)/)?.[1] ?? null,
    elapsed: last.match(/elapsed=(\S+)/)?.[1] ?? null,
    timeout: last.match(/timeout=(\S+)/)?.[1] ?? null,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseEvents(text) {
  return String(text ?? "")
    .split("\n")
    .map(parseJson)
    .filter((e) => e && typeof e.kind === "string");
}

/**
 * Turns the run directory's files into the page state. Pure: `entries` are
 * `{ name, text, mtimeMs }` as read from disk.
 * @param {{ name: string, text: string, mtimeMs: number }[]} entries
 * @param {number} [now]
 */
export function deriveState(entries, now = Date.now()) {
  const by = new Map(entries.map((e) => [e.name, e]));
  const file = (name) => by.get(name) ?? null;
  const json = (name) => (by.has(name) ? parseJson(by.get(name).text) : null);
  const meta = json("watch.json") ?? {};
  const events = parseEvents(file("events.jsonl")?.text);
  const startedAt =
    Date.parse(meta.startedAt) ||
    Math.min(now, ...entries.map((e) => e.mtimeMs));
  const roundNumbers = entries
    .map((e) => Number(e.name.match(/^round-(\d+)\.md$/)?.[1]))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const messages = [];
  const titles = {};
  const plan = meta.plan || extractPlan(file("round-1.md")?.text);
  if (plan)
    messages.push({ id: "plan", role: "user", at: startedAt, text: plan });

  const answerMessage = (name, round, retry) => {
    const f = file(name);
    if (!f) return null;
    const answers = parseAnswers(f.text).map(({ id, fields }) => ({
      id,
      ...fields,
    }));
    return { id: name, role: "proxy", round, retry, at: f.mtimeMs, answers };
  };
  const gateMessage = (name, round, retry) => {
    const f = file(name);
    const gate = f && parseJson(f.text);
    if (!gate) return null;
    return {
      id: name,
      role: "judge",
      round,
      retry,
      at: f.mtimeMs,
      results: (gate.results ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        why: r.why ?? "",
        fix: r.fix ?? [],
      })),
      stop: gate.stop ?? [],
      error: gate.error ?? null,
    };
  };

  for (const n of roundNumbers) {
    const q = file(`round-${n}.md`);
    const questions = parseQuestions(q.text);
    for (const item of questions) titles[item.id] = item.title;
    messages.push({
      id: q.name,
      role: "interviewer",
      round: n,
      at: q.mtimeMs,
      questions,
    });
    for (const m of [
      answerMessage(`answers-${n}.md`, n, false),
      gateMessage(`gate-${n}.json`, n, false),
      answerMessage(`answers-${n}-retry.md`, n, true),
      gateMessage(`gate-${n}-retry.json`, n, true),
    ])
      if (m) messages.push(m);
  }

  const redQuestion = file("redteam-question.md");
  const redAnswer = file("redteam.md");
  if (redAnswer)
    messages.push({
      id: "redteam",
      role: "redteam",
      at: redAnswer.mtimeMs,
      verdicts: parseVerdicts(redAnswer.text),
      text: redAnswer.text.trim(),
    });
  events.forEach((e, i) =>
    messages.push({
      id: `event-${i}`,
      role: "system",
      kind: e.kind,
      text: String(e.text ?? ""),
      at: Date.parse(e.at) || now,
    }),
  );
  // The plan opens the chat even when round 1 was written before `start`.
  messages.sort(
    (a, b) => (b.role === "user") - (a.role === "user") || a.at - b.at,
  );

  const ledger = json("ledger.json");
  const questions = Object.entries(ledger?.questions ?? {});
  const pick = (status) =>
    questions
      .filter(([, q]) => q.status === status)
      .map(([id, q]) => ({
        id,
        title: titles[id] ?? "",
        decision: q.decision ?? "",
        why: q.why ?? "",
      }));
  const totals = {
    Decided: pick("Decided"),
    Assumption: pick("Assumption"),
    Escalation: pick("Escalation"),
  };

  const done = events.findLast((e) => e.kind === "done");
  const failed = events.findLast((e) => e.kind === "failed");
  const phase = done ? "done" : failed ? "failed" : "live";
  const lastRound = roundNumbers.at(-1) ?? 0;
  const lastGate =
    json(`gate-${lastRound}-retry.json`) ?? json(`gate-${lastRound}.json`);

  /** Who is working now, inferred from which file of the round is still missing. */
  let activity = null;
  const since = (name) => file(name)?.mtimeMs ?? startedAt;
  if (phase === "live") {
    const r = lastRound;
    const heartbeat = parseHeartbeat(file(`proxy-${r}.log`)?.text);
    if (!r) {
      activity = { seat: "interviewer", task: "map", since: startedAt };
    } else if (!file(`answers-${r}.md`)) {
      activity = {
        seat: "proxy",
        task: "answer",
        round: r,
        since: since(`round-${r}.md`),
        heartbeat,
      };
    } else if (!file(`gate-${r}.json`)) {
      activity = {
        seat: "judge",
        task: "gate",
        round: r,
        since: since(`answers-${r}.md`),
      };
    } else if (
      json(`gate-${r}.json`)?.reask?.length &&
      !file(`answers-${r}-retry.md`)
    ) {
      activity = {
        seat: "proxy",
        task: "retry",
        round: r,
        since: since(`gate-${r}.json`),
        heartbeat,
      };
    } else if (file(`answers-${r}-retry.md`) && !file(`gate-${r}-retry.json`)) {
      activity = {
        seat: "judge",
        task: "gate",
        round: r,
        since: since(`answers-${r}-retry.md`),
      };
    } else if (redQuestion && !redAnswer) {
      activity = {
        seat: "redteam",
        task: "redteam",
        since: redQuestion.mtimeMs,
      };
    } else if (redAnswer || lastGate?.stop?.length || r >= MAX_ROUNDS) {
      activity = {
        seat: "interviewer",
        task: "close",
        since: redAnswer?.mtimeMs ?? since(`gate-${r}.json`),
      };
    } else {
      const gateFile = file(`gate-${r}-retry.json`)
        ? `gate-${r}-retry.json`
        : `gate-${r}.json`;
      activity = {
        seat: "interviewer",
        task: "next",
        round: r + 1,
        since: since(gateFile),
      };
    }
  }

  return {
    topic: meta.topic ?? "",
    seats: meta.seats ?? {},
    startedAt,
    endedAt: done
      ? Date.parse(done.at) || now
      : failed
        ? Date.parse(failed.at) || now
        : null,
    phase,
    round: lastRound,
    maxRounds: MAX_ROUNDS,
    activity,
    messages,
    totals,
    stop: lastGate?.stop ?? [],
    logPath: done?.text ?? "",
    now,
  };
}

/** Reads the watched files of a run directory for deriveState. */
export function readRun(run) {
  let names;
  try {
    names = fs.readdirSync(run);
  } catch {
    return [];
  }
  return names
    .filter((name) => WATCHED.test(name))
    .flatMap((name) => {
      try {
        const file = path.join(run, name);
        const st = fs.statSync(file);
        if (!st.isFile() || st.size > MAX_FILE_BYTES) return [];
        return [
          {
            name,
            mtimeMs: st.mtimeMs,
            size: st.size,
            text: fs.readFileSync(file, "utf8"),
          },
        ];
      } catch {
        return [];
      }
    });
}

function signature(run) {
  try {
    return fs
      .readdirSync(run)
      .filter((name) => WATCHED.test(name))
      .map((name) => {
        try {
          const st = fs.statSync(path.join(run, name));
          return `${name}:${st.mtimeMs}:${st.size}`;
        } catch {
          return name;
        }
      })
      .sort()
      .join("|");
  } catch {
    return "";
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Runs the page server until the run is done or quiet. */
export function serve({ run, port = 0 }) {
  const metaPath = path.join(run, "watch.json");
  const clients = new Set();
  const bornAt = Date.now();
  let lastSig = signature(run);
  let lastChange = Date.now();
  let state = deriveState(readRun(run));
  const payload = () =>
    `data: ${JSON.stringify({ ...state, now: Date.now() })}\n\n`;

  const server = http.createServer((req, res) => {
    // The Host check keeps other sites (DNS rebinding) from reading the run.
    if (
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "") ||
      req.method !== "GET"
    ) {
      res.writeHead(403);
      return res.end();
    }
    const url = (req.url || "/").split("?")[0];
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(fs.readFileSync(PAGE, "utf8"));
    }
    if (url === "/state") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      return res.end(JSON.stringify({ ...state, now: Date.now() }));
    }
    if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      res.write(payload());
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, run }));
    }
    res.writeHead(404);
    res.end();
  });

  const shutdown = () => {
    for (const c of clients) c.end();
    server.close();
    server.closeAllConnections?.();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    writeJsonFile(metaPath, {
      ...(readJsonFile(metaPath) ?? {}),
      pid: process.pid,
      url,
    });
    lastSig = signature(run);
  });

  setInterval(() => {
    const now = Date.now();
    const sig = signature(run);
    if (sig !== lastSig) {
      lastSig = sig;
      lastChange = now;
      state = deriveState(readRun(run), now);
      const data = payload();
      for (const c of clients) c.write(data);
    }
    const idle = clients.size === 0;
    if (
      now - bornAt > MAX_LIFE_MS ||
      (idle && state.phase !== "live" && now - lastChange > AFTER_DONE_MS) ||
      (idle && now - lastChange > QUIET_MS)
    )
      shutdown();
  }, POLL_MS);
  // Comments keep idle SSE connections from being dropped by the browser.
  setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 15_000);
}

async function healthy(url, run) {
  try {
    const res = await fetch(new URL("health", url), {
      signal: AbortSignal.timeout(800),
    });
    return (await res.json()).run === run;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* the URL line is enough */
  }
}

async function start(args) {
  const run = path.resolve(args.run);
  fs.mkdirSync(run, { recursive: true });
  const metaPath = path.join(run, "watch.json");
  const prev = readJsonFile(metaPath);
  const open = args["no-open"] !== true && args.open !== false;
  if (prev?.url && (await healthy(prev.url, run))) {
    if (open) openBrowser(prev.url);
    console.log(`grill-watch: ${prev.url} (already running, pid ${prev.pid})`);
    return;
  }
  // A restart (server gone, same run) keeps what the first start recorded.
  const seat = (key) =>
    args[key] === undefined
      ? (prev?.seats?.[key] ?? null)
      : parseSeat(args[key]);
  writeJsonFile(metaPath, {
    topic:
      typeof args.topic === "string"
        ? args.topic
        : (prev?.topic ?? path.basename(run)),
    seats: {
      interviewer: seat("interviewer"),
      proxy: seat("proxy"),
      redteam: seat("redteam"),
    },
    startedAt: prev?.startedAt ?? new Date().toISOString(),
  });
  const child = spawn(
    process.execPath,
    [
      SELF,
      "serve",
      `--run=${run}`,
      ...(args.port ? [`--port=${args.port}`] : []),
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  let meta = null;
  for (let i = 0; i < 50 && !(meta?.url && meta.pid === child.pid); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    meta = readJsonFile(metaPath);
  }
  if (!meta?.url || meta.pid !== child.pid) {
    console.log(
      "grill-watch: the page did not start; continue the grill without it",
    );
    return;
  }
  if (open) openBrowser(meta.url);
  console.log(`grill-watch: ${meta.url} (pid ${meta.pid})`);
}

function event(args) {
  const run = path.resolve(args.run);
  fs.mkdirSync(run, { recursive: true });
  const line = {
    kind: String(args.kind),
    text: typeof args.text === "string" ? args.text : "",
    at: new Date().toISOString(),
  };
  fs.appendFileSync(
    path.join(run, "events.jsonl"),
    `${JSON.stringify(line)}\n`,
    "utf8",
  );
}

async function stop(args) {
  const run = path.resolve(args.run);
  const meta = readJsonFile(path.join(run, "watch.json"));
  // Only signal the pid when its server answers for this run.
  if (meta?.pid && meta.url && (await healthy(meta.url, run))) {
    process.kill(meta.pid, "SIGTERM");
    console.log(`grill-watch: stopped pid ${meta.pid}`);
  } else {
    console.log("grill-watch: not running");
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const usage =
    "usage: grill-watch.mjs start --run=<dir> --topic=<t> --interviewer=<seat> --proxy=<seat> [--redteam=<seat>|none] [--no-open] | event --run=<dir> --kind=done|fallback|failed|note [--text=<line>] | stop --run=<dir>";
  if (
    typeof args.run !== "string" ||
    !["start", "event", "stop", "serve"].includes(command)
  ) {
    console.log(usage);
    process.exit(2);
  }
  if (
    command === "event" &&
    !["done", "fallback", "failed", "note"].includes(args.kind)
  ) {
    console.log(`--kind must be done, fallback, failed or note. ${usage}`);
    process.exit(2);
  }
  if (command === "start") await start(args);
  else if (command === "event") event(args);
  else if (command === "stop") await stop(args);
  else serve({ run: path.resolve(args.run), port: Number(args.port) || 0 });
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
)
  main();
