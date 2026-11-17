import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// lib/plugins reads src/generated/plugins-index.json under process.cwd() when it loads.
async function loadWith(nodeEnv: string, index?: unknown) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-loader-"));
  if (index !== undefined) {
    fs.mkdirSync(path.join(cwd, "src/generated"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "src/generated/plugins-index.json"),
      JSON.stringify(index),
    );
  }
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  try {
    return await import("@/lib/plugins");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe("plugin index loader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("fails a production build when the index file is missing", async () => {
    await expect(loadWith("production")).rejects.toThrow(
      /pnpm run plugins:index/,
    );
  });

  it("fails a production build when the index file does not match the schema", async () => {
    await expect(loadWith("production", { plugins: "nope" })).rejects.toThrow(
      /does not match the plugin index schema/,
    );
  });

  it("treats a missing index as no plugins outside production", async () => {
    const plugins = await loadWith("test");
    expect(plugins.getAllPlugins()).toEqual([]);
  });
});
