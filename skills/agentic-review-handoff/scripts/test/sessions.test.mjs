import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cmdSessions } from "../review-loop/sessions.mjs";

function writeSession(root, branch, packet, record) {
  const dir = path.join(root, ".review-handoff", "runtime", branch, packet);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "reviewer-session.json"),
    typeof record === "string" ? record : JSON.stringify(record),
    "utf8",
  );
}

test("sessions lists resume commands per product, newest first", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rl-sessions-"));
  writeSession(root, "main", "p-old", {
    product: "codex",
    sessionId: "aaaaaaaa-0000-0000-0000-000000000001",
    updated: "2026-07-22T01:00:00.000Z",
  });
  writeSession(root, "main", "p-new", {
    product: "grok",
    sessionId: "bbbbbbbb-0000-0000-0000-000000000002",
    updated: "2026-07-22T09:00:00.000Z",
  });
  writeSession(root, "main", "p-broken", "{not json");
  writeSession(root, "main", "p-unknown", {
    product: "mystery",
    sessionId: "cccccccc-0000-0000-0000-000000000003",
    updated: "2026-07-22T02:00:00.000Z",
  });

  const r = cmdSessions({ repoRoot: root });
  assert.equal(r.ok, true);
  assert.equal(
    r.count,
    3,
    "broken json skipped; unknown product kept with note",
  );
  assert.equal(r.sessions[0].product, "grok", "sorted newest first");
  assert.equal(
    r.sessions[0].resume.interactive,
    "grok -r bbbbbbbb-0000-0000-0000-000000000002",
  );
  assert.match(r.sessions[0].resume.headless, /^grok -r .* -p /);
  const codexRow = r.sessions.find((s) => s.product === "codex");
  assert.equal(
    codexRow.resume.interactive,
    "codex resume aaaaaaaa-0000-0000-0000-000000000001",
  );
  assert.match(codexRow.resume.headless, /^codex exec resume /);
  const unknown = r.sessions.find((s) => s.product === "mystery");
  assert.equal(unknown.resume.interactive, null);
  assert.match(String(unknown.resume.note), /unknown product/);

  const filtered = cmdSessions({ repoRoot: root, product: "codex" });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.sessions[0].product, "codex");
});

test("sessions on empty repo returns ok with guidance note", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rl-sessions-empty-"));
  const r = cmdSessions({ repoRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.match(String(r.note), /No reviewer or consult sessions/i);
});

test("sessions resume through the recorded account launcher", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rl-sessions-"));
  writeSession(root, "main", "p-acct", {
    product: "grok",
    command: "grok002",
    sessionId: "dddddddd-0000-0000-0000-000000000004",
    updated: "2026-07-22T03:00:00.000Z",
  });
  const r = cmdSessions({ repoRoot: root });
  assert.equal(r.sessions[0].command, "grok002");
  assert.equal(
    r.sessions[0].resume.interactive,
    "grok002 -r dddddddd-0000-0000-0000-000000000004",
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("sessions never prints a tampered launcher as a resume command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rl-sessions-"));
  writeSession(root, "main", "p-bad", {
    product: "grok",
    command: "grok002; curl evil",
    sessionId: "ffffffff-0000-0000-0000-000000000006",
  });
  const r = cmdSessions({ repoRoot: root });
  assert.equal(r.sessions[0].resume.interactive, null);
  assert.match(String(r.sessions[0].resume.note), /invalid launcher/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("sessions refuses a launcher from another product family", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rl-sessions-"));
  writeSession(root, "main", "p-mismatch", {
    product: "grok",
    command: "codex003",
    sessionId: "abababab-0000-0000-0000-000000000007",
  });
  const r = cmdSessions({ repoRoot: root });
  assert.equal(r.sessions[0].resume.interactive, null);
  fs.rmSync(root, { recursive: true, force: true });
});
