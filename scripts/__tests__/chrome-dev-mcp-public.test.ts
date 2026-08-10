import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
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
