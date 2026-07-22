#!/usr/bin/env node
// Disposable probe: isolate model reachability vs sandbox write-enforcement for the relay-read-only profile.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = process.argv[2];
const relay = resolve(repo, "tmp/relay");
const fsProfile = `{mode="Restricted",entries=[{access="read",path=":workspace_roots"},{access="write",path="${relay}"}],glob_scan_max_depth=8}`;
const args = [
  "exec",
  "--json",
  "-C",
  repo,
  "-c",
  'default_permissions="relay-read-only"',
  "-c",
  'permission_profile="relay-read-only"',
  "-c",
  `permissions.relay-read-only.file_system=${fsProfile}`,
  "-c",
  "permissions.relay-read-only.network={enabled=false}",
  "-",
];
const prompt =
  "Create a file at tmp/relay/probe-out.txt containing exactly the word PONG using apply_patch, then stop.";
const res = spawnSync("codex", args, {
  input: prompt,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(
  `===STATUS=${res.status} ERROR=${res.error ?? "none"}===\n`,
);
process.stdout.write(
  `===STDOUT===\n${res.stdout ?? ""}\n===STDERR===\n${res.stderr ?? ""}\n`,
);
try {
  process.stdout.write(
    `===PROBE-OUT===\n${readFileSync(resolve(relay, "probe-out.txt"), "utf8")}\n`,
  );
} catch (e) {
  process.stdout.write(`===PROBE-OUT-MISSING=${e.code ?? e.message}===\n`);
}
