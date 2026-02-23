import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTempDir(prefix: string): string {
	return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(baseDir: string, relativePath: string, content: string): string {
	const fullPath = path.join(baseDir, relativePath);
	mkdirSync(path.dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content, "utf8");
	return fullPath;
}

export function cleanupTempDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

export function buildPoWithRefs(refs: string[]): string {
	const refLines = refs.map((ref) => `#: ${ref}`).join("\n");
	return `msgid ""\nmsgstr ""\n\n${refLines}\nmsgid "test.id"\nmsgstr "test"\n`;
}
