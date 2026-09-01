import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const skillDir = path.join(repoRoot, "skills/chrome-dev-mcp");
const figmaSkillDir = path.join(repoRoot, "skills/figma-mcp");
const localWebSurfaceSkillDir = path.join(repoRoot, "skills/local-web-surface");

const uxcAssetSha256 =
  process.arch === "arm64"
    ? "5ab49af22246acd34e41ebeefb5d7bdb4ffccb67118f11889a088cb938850f68"
    : "85b6516c60bcd211367296c5e8aa7f541f747ac96ad97327a44264822292b79c";
const uxcTargetTriple =
  process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";

async function writeOwnedUxc(
  linkDir: string,
  content: string,
): Promise<string> {
  const uxcPath = path.join(linkDir, "uxc");
  const binarySha256 = createHash("sha256").update(content).digest("hex");

  await writeFile(uxcPath, content, "utf8");
  await chmod(uxcPath, 0o755);
  await writeFile(
    `${uxcPath}.chrome-dev-mcp.manifest`,
    [
      "OWNER=chrome-dev-mcp",
      "UXC_VERSION=0.17.0",
      `TARGET_TRIPLE=${uxcTargetTriple}`,
      `ASSET_SHA256=${uxcAssetSha256}`,
      `BINARY_SHA256=${binarySha256}`,
      "",
    ].join("\n"),
    "utf8",
  );

  return uxcPath;
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function runScript(options: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  script: string;
}): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.script, options.args ?? [], {
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

test("public chrome-dev-mcp source contains no machine-specific runtime contract", async () => {
  const files = await collectFiles(skillDir);
  assert.ok(files.some((file) => file.endsWith("/SKILL.md")));

  const forbidden = [
    /\/Users\//,
    /127\.0\.0\.1:\d+/,
    /~\/\.(?:agents|claude|chrome)/,
    /\$HOME\/\.(?:agents|claude|chrome)/,
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        content,
        pattern,
        `${path.relative(repoRoot, file)} contains ${pattern}`,
      );
    }
  }
});

test("chrome readiness-plus-task reuses one private page discovery result", async () => {
  const skill = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const uxcFacade = await readFile(
    path.join(skillDir, "references/uxc-facade.md"),
    "utf8",
  );
  const evals = JSON.parse(
    await readFile(path.join(skillDir, "evals/evals.json"), "utf8"),
  ) as {
    evals: Array<{ id: number; name: string; expectations: string[] }>;
  };
  const triggers = JSON.parse(
    await readFile(path.join(skillDir, "evals/trigger-eval.json"), "utf8"),
  ) as Array<{ query: string; should_trigger: boolean }>;

  assert.match(skill, /readiness-plus-task fast path/);
  assert.match(skill, /scripts\/uxc-readiness\.zsh --private-result/);
  assert.match(
    skill,
    /reuse that same current-turn result as both transport proof and fresh numeric `pageId` resolution/,
  );
  assert.match(skill, /Do not run the payload-discarding mode first/);
  assert.match(
    skill,
    /successful `list_pages` proves readiness, not the requested page operation/,
  );
  assert.match(skill, /no recovery, navigation, or target ambiguity/);
  assert.match(
    skill,
    /retry exactly once with the same path: `scripts\/uxc-readiness\.zsh` for readiness-only, or `scripts\/uxc-readiness\.zsh --private-result`/,
  );
  assert.match(
    uxcFacade,
    /installation acceptance, not the readiness-plus-task fast path/,
  );
  assert.match(uxcFacade, /eligible current-turn private result/);

  const fastPathEval = evals.evals.find((entry) => entry.id === 6);
  assert.equal(fastPathEval?.name, "readiness-plus-network-fast-path");
  assert.ok(
    fastPathEval?.expectations.some((expectation) =>
      expectation.includes("exactly one list_pages result"),
    ),
  );
  assert.ok(
    triggers.some((entry) => entry.should_trigger && /CDP/.test(entry.query)),
  );
  assert.ok(
    triggers.some((entry) => !entry.should_trigger && /填表/.test(entry.query)),
  );
});

test("Chrome private-result readiness keeps one managed result despite poisoned PATH", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-private-result-"),
  );
  try {
    const fixtureSkillDir = path.join(fixtureDir, "skill");
    const fixtureScriptsDir = path.join(fixtureSkillDir, "scripts");
    const linkDir = path.join(fixtureDir, "managed");
    const foreignDir = path.join(fixtureDir, "foreign");
    const wrapperPath = path.join(fixtureDir, "safe-wrapper.zsh");
    const configPath = path.join(fixtureDir, "config.zsh");
    const ownedMarker = path.join(fixtureDir, "owned-calls");
    const foreignMarker = path.join(fixtureDir, "foreign-calls");
    const exclusiveKey = path.join(fixtureDir, "chrome-profile");

    await cp(path.join(skillDir, "scripts"), fixtureScriptsDir, {
      recursive: true,
    });
    const canonicalSkillDir = await realpath(fixtureSkillDir);
    await mkdir(linkDir, { recursive: true });
    await mkdir(foreignDir, { recursive: true });
    await writeFile(wrapperPath, "#!/bin/zsh\nexit 0\n", "utf8");
    await chmod(wrapperPath, 0o755);

    const ownedContent = `#!/bin/zsh\nif [[ "\${1:-}" == "--version" ]]; then\n  print -- "uxc 0.17.0"\n  exit 0\nfi\nprint -- call >> '${ownedMarker}'\nprint -r -- '{"ok":true,"protocol":"mcp","operation":"list_pages","meta":{"daemon_session_reused":true},"result":{"pageId":17}}'\n`;
    const ownedSha256 = createHash("sha256").update(ownedContent).digest("hex");
    await writeOwnedUxc(linkDir, ownedContent);

    const releasePath = path.join(fixtureScriptsDir, "lib/uxc-release.zsh");
    const release = await readFile(releasePath, "utf8");
    const releaseKey =
      process.arch === "arm64"
        ? "UXC_BINARY_SHA256_AARCH64_APPLE_DARWIN"
        : "UXC_BINARY_SHA256_X86_64_APPLE_DARWIN";
    await writeFile(
      releasePath,
      release.replace(
        new RegExp(`(${releaseKey}=\")[a-f0-9]{64}(\")`),
        `$1${ownedSha256}$2`,
      ),
      "utf8",
    );

    const linkPath = path.join(linkDir, "chrome-dev-mcp-cli");
    await writeFile(
      linkPath,
      "#!/usr/bin/env sh\n" +
        "# Generated by uxc link; do not edit by hand\n" +
        `UXC_DAEMON_EXCLUSIVE='${exclusiveKey}' UXC_DAEMON_IDLE_TTL='900' UXC_LINK_SKILL='chrome-dev-mcp' UXC_LINK_SKILL_PATH='${canonicalSkillDir}' UXC_LINK_NAME='chrome-dev-mcp-cli' exec uxc '${wrapperPath}' "$@"\n`,
      "utf8",
    );
    await chmod(linkPath, 0o755);

    const foreignUxc = path.join(foreignDir, "uxc");
    await writeFile(
      foreignUxc,
      `#!/bin/zsh\nprint -- call >> '${foreignMarker}'\nexit 70\n`,
      "utf8",
    );
    await chmod(foreignUxc, 0o755);
    await writeFile(
      configPath,
      `typeset -gx CHROME_DEV_MCP_WRAPPER='${wrapperPath}'\n` +
        `typeset -gx CHROME_DEV_MCP_UXC_EXCLUSIVE_KEY='${exclusiveKey}'\n` +
        `typeset -gx CHROME_DEV_MCP_LINK_DIR='${linkDir}'\n`,
      "utf8",
    );

    const result = await runScript({
      script: path.join(fixtureScriptsDir, "uxc-readiness.zsh"),
      args: ["--private-result"],
      env: {
        CHROME_DEV_MCP_CONFIG_FILE: configPath,
        PATH: `${foreignDir}:/usr/bin:/bin`,
      },
    });

    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).result.pageId, 17);
    assert.equal((await readFile(ownedMarker, "utf8")).trim(), "call");
    await assert.rejects(() => readFile(foreignMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("figma read-only fast path preserves identity gates and resolves Cursor CLI", async () => {
  const skill = await readFile(path.join(figmaSkillDir, "SKILL.md"), "utf8");
  const hostVerification = await readFile(
    path.join(figmaSkillDir, "references/host-verification.md"),
    "utf8",
  );
  const evals = JSON.parse(
    await readFile(path.join(figmaSkillDir, "evals/evals.json"), "utf8"),
  ) as {
    evals: Array<{ id: number; name: string; expectations: string[] }>;
  };
  const triggers = JSON.parse(
    await readFile(path.join(figmaSkillDir, "evals/trigger-eval.json"), "utf8"),
  ) as Array<{ query: string; should_trigger: boolean }>;

  assert.match(
    skill,
    /single-host read-only file or node task where the user accepts the current account/,
  );
  assert.match(
    skill,
    /readiness-only, a named account, an account switch, recovery, a write, or multi-host acceptance/,
  );
  assert.match(skill, /do not add a separate `whoami` call/);
  assert.match(
    skill,
    /For this multi-host table, use `WHOAMI` in the Proof call column for every host/,
  );
  assert.match(
    skill,
    /Proof call: REQUESTED_READ` and `Account: NOT_READ` outside this table/,
  );

  assert.match(hostVerification, /command -v cursor-agent/);
  assert.match(hostVerification, /command -v cursor-cli/);
  const cursorSection =
    hostVerification
      .split("## Cursor")[1]
      ?.split("## Run the real acceptance")[0] ?? "";
  assert.match(cursorSection, /```zsh/);
  assert.doesNotMatch(cursorSection, /```bash/);
  assert.match(
    hostVerification,
    /Do not add it before a current-account, single-host, read-only file or node task/,
  );
  assert.doesNotMatch(hostVerification, /^agent mcp /m);

  const fastPathEval = evals.evals.find((entry) => entry.id === 6);
  assert.equal(fastPathEval?.name, "current-account-read-fast-path");
  assert.ok(
    triggers.some(
      (entry) =>
        entry.should_trigger && /requires authentication/.test(entry.query),
    ),
  );
  assert.ok(
    triggers.some(
      (entry) => !entry.should_trigger && /实现成 React/.test(entry.query),
    ),
  );
});

test("local web surface scopes launchers and host-only verification proportionally", async () => {
  const skill = await readFile(
    path.join(localWebSurfaceSkillDir, "SKILL.md"),
    "utf8",
  );
  const openaiMetadata = await readFile(
    path.join(localWebSurfaceSkillDir, "agents/openai.yaml"),
    "utf8",
  );
  const evals = JSON.parse(
    await readFile(
      path.join(localWebSurfaceSkillDir, "evals/evals.json"),
      "utf8",
    ),
  ) as {
    evals: Array<{ id: number; eval_name: string; expectations: string[] }>;
  };
  const triggers = JSON.parse(
    await readFile(
      path.join(localWebSurfaceSkillDir, "evals/trigger-eval.json"),
      "utf8",
    ),
  ) as Array<{ query: string; should_trigger: boolean }>;

  assert.match(skill, /Host\/handler-only/);
  assert.match(skill, /canonical `200`\/未知 Host `421`\/跨 surface `404`/);
  assert.match(
    skill,
    /只包装 `https:\/\/\.\.\.` 公网或内网页面的 `.app` 不属于本 Skill/,
  );
  assert.doesNotMatch(skill, /交给 `audit-website`/);
  assert.doesNotMatch(
    skill,
    /Done signals: <tests \+ curl \+ launchctl \+ browser>/,
  );
  assert.doesNotMatch(skill, /\*\*Gateway tests\*\*.*launcher specs/);
  assert.match(skill, /\*\*Lifecycle\/launcher tests（条件）\*\*/);
  assert.match(
    skill,
    /Verification: <exact evidence selected by Change surfaces>/,
  );
  assert.match(
    openaiMetadata,
    /thin \.app launcher that opens or wakes such a persistent local HTTP surface/,
  );
  assert.doesNotMatch(openaiMetadata, /or \.app launcher;/);

  const hostOnlyEval = evals.evals.find((entry) => entry.id === 4);
  assert.ok(
    hostOnlyEval?.expectations.some((expectation) =>
      expectation.includes("Host/handler-only"),
    ),
  );
  assert.equal(
    evals.evals.find((entry) => entry.id === 9)?.eval_name,
    "remote-url-app-wrapper-is-out-of-scope",
  );
  assert.ok(
    triggers.some(
      (entry) =>
        !entry.should_trigger &&
        /intranet\.example\.com/.test(entry.query) &&
        /macOS \.app/.test(entry.query),
    ),
  );
});

test("connection recovery uses the configured wrapper and launcher", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-public-"),
  );
  try {
    const statePath = path.join(fixtureDir, "ready");
    const wrapperPath = path.join(fixtureDir, "safe wrapper.zsh");
    const launcherPath = path.join(fixtureDir, "launcher.zsh");
    const configPath = path.join(fixtureDir, "config.zsh");

    await writeFile(
      wrapperPath,
      `#!/bin/zsh\n[[ \"\${1:-}\" == \"--check\" ]] || exit 64\n[[ -f \"$TEST_STATE\" ]] && exit 0\nprint -u2 -- \"endpoint unavailable\"\nexit 69\n`,
      "utf8",
    );
    await writeFile(launcherPath, '#!/bin/zsh\n: > "$TEST_STATE"\n', "utf8");
    await chmod(wrapperPath, 0o755);
    await chmod(launcherPath, 0o755);
    await writeFile(
      configPath,
      `typeset -gx CHROME_DEV_MCP_WRAPPER='${wrapperPath}'\n` +
        `typeset -gx CHROME_DEV_MCP_LAUNCHER='${launcherPath}'\n`,
      "utf8",
    );

    const result = await runScript({
      script: path.join(skillDir, "scripts/ensure-connection.zsh"),
      args: ["--recover"],
      env: {
        CHROME_DEV_MCP_CONFIG_FILE: configPath,
        TEST_STATE: statePath,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^CHROME_DEV_MCP_CONNECTION=READY$/m);
    assert.match(result.stdout, /^RECOVERY=PERFORMED$/m);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("structured identity failure never launches recovery", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-identity-"),
  );
  try {
    const wrapperPath = path.join(fixtureDir, "safe-wrapper.zsh");
    const launcherPath = path.join(fixtureDir, "launcher.zsh");
    const launchMarker = path.join(fixtureDir, "launcher-ran");
    const configPath = path.join(fixtureDir, "config.zsh");

    await writeFile(
      wrapperPath,
      '#!/bin/zsh\nprint -u2 -- "CHROME_DEVTOOLS_MCP_SAFE_REASON=WRONG_PROFILE"\nprint -u2 -- "human wording may change"\nexit 69\n',
      "utf8",
    );
    await writeFile(
      launcherPath,
      '#!/bin/zsh\n: > "$TEST_LAUNCH_MARKER"\n',
      "utf8",
    );
    await chmod(wrapperPath, 0o755);
    await chmod(launcherPath, 0o755);
    await writeFile(
      configPath,
      `typeset -gx CHROME_DEV_MCP_WRAPPER='${wrapperPath}'\n` +
        `typeset -gx CHROME_DEV_MCP_LAUNCHER='${launcherPath}'\n`,
      "utf8",
    );

    const result = await runScript({
      script: path.join(skillDir, "scripts/ensure-connection.zsh"),
      args: ["--recover"],
      env: {
        CHROME_DEV_MCP_CONFIG_FILE: configPath,
        TEST_LAUNCH_MARKER: launchMarker,
      },
    });

    assert.equal(result.code, 69);
    assert.match(result.stdout, /^CHROME_DEV_MCP_CONNECTION=NOT_READY$/m);
    assert.match(result.stdout, /^REASON=WRONG_PROFILE$/m);
    await assert.rejects(() => readFile(launchMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("UXC installer exposes a pinned official release manifest without downloading", async () => {
  const result = await runScript({
    script: path.join(skillDir, "scripts/install-uxc.zsh"),
    args: ["--manifest"],
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^UXC_VERSION=0\.17\.0$/m);
  assert.match(
    result.stdout,
    /^UXC_REPOSITORY=https:\/\/github\.com\/holon-run\/uxc$/m,
  );
  assert.match(
    result.stdout,
    /^UXC_SHA256_AARCH64_APPLE_DARWIN=[a-f0-9]{64}$/m,
  );
  assert.match(result.stdout, /^UXC_SHA256_X86_64_APPLE_DARWIN=[a-f0-9]{64}$/m);
});

test("UXC installer rejects an unowned binary without executing or overwriting it", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-uxc-conflict-"),
  );
  try {
    const foreignBinary = path.join(fixtureDir, "uxc");
    const executionMarker = path.join(fixtureDir, "executed");
    await writeFile(
      foreignBinary,
      `#!/bin/zsh\n: > '${executionMarker}'\nprint -- "uxc 0.17.0"\n`,
      "utf8",
    );
    await chmod(foreignBinary, 0o755);

    const result = await runScript({
      script: path.join(skillDir, "scripts/install-uxc.zsh"),
      env: { UXC_INSTALL_DIR: fixtureDir },
    });

    assert.equal(result.code, 69);
    assert.match(result.stderr, /^ERROR_CLASS=foreign_uxc$/m);
    assert.equal(
      await readFile(foreignBinary, "utf8"),
      `#!/bin/zsh\n: > '${executionMarker}'\nprint -- "uxc 0.17.0"\n`,
    );
    await assert.rejects(() => readFile(executionMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("UXC installer rejects a forged ownership manifest without executing the binary", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-uxc-forged-"),
  );
  try {
    const foreignBinary = path.join(fixtureDir, "uxc");
    const executionMarker = path.join(fixtureDir, "executed");
    const content = `#!/bin/zsh\n: > '${executionMarker}'\nprint -- "uxc 0.17.0"\n`;
    const binarySha256 = createHash("sha256").update(content).digest("hex");

    await writeFile(foreignBinary, content, "utf8");
    await chmod(foreignBinary, 0o755);
    await writeFile(
      `${foreignBinary}.chrome-dev-mcp.manifest`,
      [
        "OWNER=chrome-dev-mcp",
        "UXC_VERSION=0.17.0",
        `TARGET_TRIPLE=${uxcTargetTriple}`,
        `ASSET_SHA256=${uxcAssetSha256}`,
        `BINARY_SHA256=${binarySha256}`,
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runScript({
      script: path.join(skillDir, "scripts/install-uxc.zsh"),
      env: { UXC_INSTALL_DIR: fixtureDir },
    });

    assert.equal(result.code, 69);
    assert.match(result.stderr, /^ERROR_CLASS=foreign_uxc$/m);
    await assert.rejects(() => readFile(executionMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("UXC installer rejects a symlink without executing its target", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-uxc-symlink-"),
  );
  try {
    const foreignBinary = path.join(fixtureDir, "foreign-uxc");
    const executionMarker = path.join(fixtureDir, "executed");
    await writeFile(
      foreignBinary,
      `#!/bin/zsh\n: > '${executionMarker}'\nprint -- "uxc 0.17.0"\n`,
      "utf8",
    );
    await chmod(foreignBinary, 0o755);
    await symlink(foreignBinary, path.join(fixtureDir, "uxc"));

    const result = await runScript({
      script: path.join(skillDir, "scripts/install-uxc.zsh"),
      env: { UXC_INSTALL_DIR: fixtureDir },
    });

    assert.equal(result.code, 69);
    assert.match(result.stderr, /^ERROR_CLASS=foreign_uxc$/m);
    await assert.rejects(() => readFile(executionMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("UXC link setup refuses to overwrite a managed link with a different contract", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-link-conflict-"),
  );
  try {
    const wrapperPath = path.join(fixtureDir, "safe-wrapper.zsh");
    const wrongWrapperPath = path.join(fixtureDir, "wrong-wrapper.zsh");
    const linkPath = path.join(fixtureDir, "chrome-dev-mcp-cli");
    const invocationMarker = path.join(fixtureDir, "uxc-invoked");
    const configPath = path.join(fixtureDir, "config.zsh");
    const exclusiveKey = path.join(fixtureDir, "chrome-profile");
    const uxcContent = `#!/bin/zsh\nif [[ "\${1:-}" == "--version" ]]; then\n  print -- "uxc 0.17.0"\n  exit 0\nfi\n: > '${invocationMarker}'\n`;
    const originalLink =
      "#!/usr/bin/env sh\n" +
      "# Generated by uxc link; do not edit by hand\n" +
      `UXC_DAEMON_EXCLUSIVE='${exclusiveKey}' UXC_DAEMON_IDLE_TTL='900' UXC_LINK_SKILL='chrome-dev-mcp' UXC_LINK_SKILL_PATH='${skillDir}' UXC_LINK_NAME='chrome-dev-mcp-cli' exec uxc '${wrongWrapperPath}' "$@"\n`;

    await writeOwnedUxc(fixtureDir, uxcContent);
    await writeFile(wrapperPath, "#!/bin/zsh\nexit 0\n", "utf8");
    await writeFile(wrongWrapperPath, "#!/bin/zsh\nexit 0\n", "utf8");
    await writeFile(linkPath, originalLink, "utf8");
    await chmod(wrapperPath, 0o755);
    await chmod(wrongWrapperPath, 0o755);
    await chmod(linkPath, 0o755);
    await writeFile(
      configPath,
      `typeset -gx CHROME_DEV_MCP_WRAPPER='${wrapperPath}'\n` +
        `typeset -gx CHROME_DEV_MCP_UXC_EXCLUSIVE_KEY='${exclusiveKey}'\n` +
        `typeset -gx CHROME_DEV_MCP_LINK_DIR='${fixtureDir}'\n`,
      "utf8",
    );

    const result = await runScript({
      script: path.join(skillDir, "scripts/setup-uxc-link.zsh"),
      env: { CHROME_DEV_MCP_CONFIG_FILE: configPath },
    });

    assert.equal(result.code, 69);
    assert.match(result.stderr, /^ERROR_CLASS=link_contract_mismatch$/m);
    assert.equal(await readFile(linkPath, "utf8"), originalLink);
    await assert.rejects(() => readFile(invocationMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("UXC link setup leaves an exact contract untouched but rejects its unowned runtime", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-link-idempotent-"),
  );
  try {
    const wrapperPath = path.join(fixtureDir, "safe-wrapper.zsh");
    const linkPath = path.join(fixtureDir, "chrome-dev-mcp-cli");
    const invocationMarker = path.join(fixtureDir, "uxc-invoked");
    const configPath = path.join(fixtureDir, "config.zsh");
    const exclusiveKey = path.join(fixtureDir, "chrome-profile");
    const uxcContent = `#!/bin/zsh\nif [[ "\${1:-}" == "--version" ]]; then\n  print -- "uxc 0.17.0"\n  exit 0\nfi\n: > '${invocationMarker}'\n`;
    const originalLink =
      "#!/usr/bin/env sh\n" +
      "# Generated by uxc link; do not edit by hand\n" +
      `UXC_DAEMON_EXCLUSIVE='${exclusiveKey}' UXC_DAEMON_IDLE_TTL='900' UXC_LINK_SKILL='chrome-dev-mcp' UXC_LINK_SKILL_PATH='${skillDir}' UXC_LINK_NAME='chrome-dev-mcp-cli' exec uxc '${wrapperPath}' "$@"\n`;

    await writeOwnedUxc(fixtureDir, uxcContent);
    await writeFile(wrapperPath, "#!/bin/zsh\nexit 0\n", "utf8");
    await writeFile(linkPath, originalLink, "utf8");
    await chmod(wrapperPath, 0o755);
    await chmod(linkPath, 0o755);
    await writeFile(
      configPath,
      `typeset -gx CHROME_DEV_MCP_WRAPPER='${wrapperPath}'\n` +
        `typeset -gx CHROME_DEV_MCP_UXC_EXCLUSIVE_KEY='${exclusiveKey}'\n` +
        `typeset -gx CHROME_DEV_MCP_LINK_DIR='${fixtureDir}'\n`,
      "utf8",
    );

    const result = await runScript({
      script: path.join(skillDir, "scripts/setup-uxc-link.zsh"),
      env: { CHROME_DEV_MCP_CONFIG_FILE: configPath },
    });

    assert.equal(result.code, 69);
    assert.match(result.stderr, /^ERROR_CLASS=foreign_uxc$/m);
    assert.equal(await readFile(linkPath, "utf8"), originalLink);
    await assert.rejects(() => readFile(invocationMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("UXC link setup rejects daemon-key and skill-owner drift before invoking UXC", async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), "chrome-dev-mcp-link-owner-drift-"),
  );
  try {
    const wrapperPath = path.join(fixtureDir, "safe-wrapper.zsh");
    const linkPath = path.join(fixtureDir, "chrome-dev-mcp-cli");
    const invocationMarker = path.join(fixtureDir, "uxc-invoked");
    const configPath = path.join(fixtureDir, "config.zsh");
    const exclusiveKey = path.join(fixtureDir, "chrome-profile");
    const uxcContent = `#!/bin/zsh\n: > '${invocationMarker}'\nprint -- "uxc 0.17.0"\n`;

    await writeOwnedUxc(fixtureDir, uxcContent);
    await writeFile(wrapperPath, "#!/bin/zsh\nexit 0\n", "utf8");
    await chmod(wrapperPath, 0o755);
    await writeFile(
      configPath,
      `typeset -gx CHROME_DEV_MCP_WRAPPER='${wrapperPath}'\n` +
        `typeset -gx CHROME_DEV_MCP_UXC_EXCLUSIVE_KEY='${exclusiveKey}'\n` +
        `typeset -gx CHROME_DEV_MCP_LINK_DIR='${fixtureDir}'\n`,
      "utf8",
    );

    const mismatches = [
      {
        name: "daemon key",
        line: `UXC_DAEMON_EXCLUSIVE='${exclusiveKey}-other' UXC_DAEMON_IDLE_TTL='900' UXC_LINK_SKILL='chrome-dev-mcp' UXC_LINK_SKILL_PATH='${skillDir}' UXC_LINK_NAME='chrome-dev-mcp-cli' exec uxc '${wrapperPath}' "$@"`,
      },
      {
        name: "skill owner",
        line: `UXC_DAEMON_EXCLUSIVE='${exclusiveKey}' UXC_DAEMON_IDLE_TTL='900' UXC_LINK_SKILL='other-owner' UXC_LINK_SKILL_PATH='${skillDir}' UXC_LINK_NAME='chrome-dev-mcp-cli' exec uxc '${wrapperPath}' "$@"`,
      },
    ];

    for (const mismatch of mismatches) {
      const originalLink =
        "#!/usr/bin/env sh\n" +
        "# Generated by uxc link; do not edit by hand\n" +
        `${mismatch.line}\n`;
      await writeFile(linkPath, originalLink, "utf8");
      await chmod(linkPath, 0o755);

      const result = await runScript({
        script: path.join(skillDir, "scripts/setup-uxc-link.zsh"),
        env: { CHROME_DEV_MCP_CONFIG_FILE: configPath },
      });

      assert.equal(result.code, 69, mismatch.name);
      assert.match(
        result.stderr,
        /^ERROR_CLASS=link_contract_mismatch$/m,
        mismatch.name,
      );
      assert.equal(await readFile(linkPath, "utf8"), originalLink);
    }

    await assert.rejects(() => readFile(invocationMarker), { code: "ENOENT" });
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
