import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cmdConsult } from '../review-loop/consult.mjs';

const cleanup = [];
afterEach(() => {
  while (cleanup.length) {
    const p = cleanup.pop();
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consult-'));
  cleanup.push(dir);
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# t\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '--quiet', '-m', 'i'], { cwd: dir });
  return dir;
}

describe('consult', () => {
  it('one-shot advisory records to runtime/consults', async () => {
    const dir = initTempRepo();
    const qf = path.join(dir, 'q.md');
    fs.writeFileSync(
      qf,
      `## 用户原话\n该用 A 还是 B？\n\n## 需要决定的问题\n选型\n\n## 已知事实\n- x\n`,
    );
    const result = await cmdConsult({
      repoRoot: dir,
      peer: 'codex',
      questionFile: qf,
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => null,
        async newSession() {
          return { ok: true, text: 'Stance: prefer A because ...', sessionId: 'c1' };
        },
        async resume() {
          throw new Error('consult should not resume');
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'advisory');
    assert.ok(fs.existsSync(result.recordPath));
    const rec = fs.readFileSync(result.recordPath, 'utf8');
    assert.match(rec, /DecisionConsult/);
    assert.match(rec, /prefer A/);
    assert.match(result.message, /advisory/i);
  });
});
