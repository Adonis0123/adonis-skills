/**
 * Packet + runtime filesystem adapters. Durable truth only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function resolveRepoRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

export function resolveBranch(repoRoot) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

export function branchSlug(branch) {
  return branch.toLowerCase().replace(/[/\\]/g, '-');
}

export function packetIdFromParts(branch, fileBase) {
  return `${branchSlug(branch)}/${fileBase.replace(/\.md$/, '')}`;
}

export function ensureReviewHandoffLayout(repoRoot) {
  const base = path.join(repoRoot, '.review-handoff');
  const active = path.join(base, 'active');
  const archive = path.join(base, 'archive');
  const runtime = path.join(base, 'runtime');
  for (const d of [base, active, archive, runtime]) {
    fs.mkdirSync(d, { recursive: true });
  }
  ensureExclude(repoRoot);
  return { base, active, archive, runtime };
}

function ensureExclude(repoRoot) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const commonAbs = path.isAbsolute(common) ? common : path.join(repoRoot, common);
    const excludePath = path.join(commonAbs, 'info', 'exclude');
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    let text = '';
    if (fs.existsSync(excludePath)) text = fs.readFileSync(excludePath, 'utf8');
    if (!text.includes('/.review-handoff/') && !/(^|\n)\.review-handoff\//.test(text)) {
      const nl = text.endsWith('\n') || text.length === 0 ? '' : '\n';
      fs.appendFileSync(excludePath, `${nl}/.review-handoff/\n`);
    }
  } catch {
    // best-effort
  }
}

export function listActivePackets(repoRoot, branch) {
  const slug = branchSlug(branch);
  const dir = path.join(repoRoot, '.review-handoff', 'active', slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(dir, f));
}

export function latestActivePacket(repoRoot, branch) {
  const list = listActivePackets(repoRoot, branch);
  return list.length ? list[list.length - 1] : null;
}

export function listArchivedPackets(repoRoot, branch) {
  const slug = branchSlug(branch);
  const dir = path.join(repoRoot, '.review-handoff', 'archive', slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(dir, f));
}

/** After a PASS archive, active/ is empty — resume from archive for read-only report. */
export function latestArchivedPacket(repoRoot, branch) {
  const list = listArchivedPackets(repoRoot, branch);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Build a concise completion report for humans/agents from the packet body.
 * Used when lifecycle is terminal (archived/stopped) so one agent chat can show "all done + summary".
 */
export function buildCompletionReport({ packetPath, meta, packetId, stopped = false }) {
  const sections = parseH1Sections(meta.text);
  const physical = sections.map((s) => ({ title: s.title, anchor: s.anchor }));
  const last = sections.at(-1) ?? null;
  const lastVerdict = sectionVerdict(last);
  const findings = extractFindingIds(sections);
  const reassessments = extractReassessmentRows(sections);
  const rounds = Number(meta.frontmatter?.round ?? meta.round ?? 1) || 1;
  const location = packetLocation(packetPath);
  const lifecycle = meta.lifecycleState;
  const allTasksComplete =
    lifecycle === 'archived'
    || stopped
    || location === 'archive'
    || (lastVerdict === 'PASS' || lastVerdict === 'NO_FINDINGS') && location === 'archive';

  const headline = allTasksComplete
    ? '✅ 任务全部完成'
    : lifecycle === 'awaiting_user_decision'
      ? '⏸ 等待你的决定（PASS_WITH_CONCERNS）'
      : lifecycle === 'blocked'
        ? '⛔ 阻塞 — 需 Fixer 继续'
        : '⏳ 进行中';

  const bullets = [];
  if (lastVerdict) bullets.push(`最终 Verdict: ${lastVerdict}`);
  if (findings.ids.length) {
    bullets.push(`Findings 记录: ${findings.ids.join(', ')}（共 ${findings.ids.length}）`);
  } else {
    bullets.push('Findings 记录: 无 / 未解析到表格 ID');
  }
  if (reassessments.length) {
    const resolved = reassessments.filter((r) => /resolv/i.test(r.status)).length;
    bullets.push(`Re-review 复评: ${resolved}/${reassessments.length} resolved`);
  }
  bullets.push(`阶段链: ${physical.map((h) => h.anchor).join(' → ') || '(empty)'}`);
  bullets.push(`round=${rounds} | last_anchor=${meta.lastAnchor} | lifecycle=${lifecycle} | loc=${location}`);

  const text = [
    headline,
    '',
    `packet_id: ${packetId ?? meta.packetId ?? '-'}`,
    `packet: ${packetPath}`,
    '',
    '## 简洁总结',
    ...bullets.map((b) => `- ${b}`),
    '',
    allTasksComplete
      ? '下一步: 无需再 continue；需要细节时打开 packet。'
      : '下一步: BLOCKED 时先修复并 review-loop fix-completion，再 run --continue；PASS_WITH_CONCERNS 等人决定。',
    '',
  ].join('\n');

  return {
    allTasksComplete: Boolean(allTasksComplete),
    headline,
    lastVerdict,
    findingIds: findings.ids,
    reassessment: reassessments,
    stages: physical,
    round: rounds,
    lastAnchor: meta.lastAnchor,
    lifecycleState: lifecycle,
    location,
    packetPath,
    packetId: packetId ?? meta.packetId ?? null,
    text,
    markdown: text,
  };
}

function extractFindingIds(sections) {
  const ids = [];
  for (const section of sections) {
    if (!/review_findings|fix_handoff|fix_completion|re_review/.test(section.anchor)) continue;
    const table = parseMarkdownTable(section.body);
    if (!table.headers.length) continue;
    const idIdx = table.headers.findIndex((h) => h === 'id' || h === 'finding id');
    if (idIdx === -1) continue;
    for (const row of table.rows) {
      const id = row[idIdx];
      if (id && !/^[-:]+$/.test(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return { ids };
}

function extractReassessmentRows(sections) {
  const out = [];
  for (const section of sections) {
    if (section.anchor !== 're_review') continue;
    const blocks = sectionH2Blocks(section);
    const prior = blocks.find((b) => b.heading.startsWith('prior findings reassessment'));
    if (!prior) continue;
    const table = parseMarkdownTable(prior.body);
    if (!table.headers.length) continue;
    const idIdx = table.headers.findIndex((h) => h === 'id' || h === 'finding id');
    const statusIdx = table.headers.findIndex((h) => /status|verdict|result/.test(h));
    for (const row of table.rows) {
      out.push({
        id: idIdx >= 0 ? row[idIdx] : row[0],
        status: statusIdx >= 0 ? row[statusIdx] : row[1] ?? '',
      });
    }
  }
  return out;
}

export function createPacketFile(repoRoot, branch, scopeSlug = 'review-loop') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/.test(scopeSlug) || scopeSlug.length > 48) {
    throw new Error(`invalid packet scope slug: ${scopeSlug}`);
  }
  ensureReviewHandoffLayout(repoRoot);
  const slug = branchSlug(branch);
  const activeDir = path.join(repoRoot, '.review-handoff', 'active', slug);
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '.review-handoff', 'archive', slug), { recursive: true });

  const minute = localMinuteStamp();
  const archiveDir = path.join(repoRoot, '.review-handoff', 'archive', slug);
  let base = `${minute}-${scopeSlug}`;
  let file = path.join(activeDir, `${base}.md`);
  let n = 2;
  // F2: avoid colliding with archived packets or runtime ids from same minute/scope
  while (
    fs.existsSync(file)
    || fs.existsSync(path.join(archiveDir, `${base}.md`))
    || fs.existsSync(path.join(repoRoot, '.review-handoff', 'runtime', packetIdFromParts(branch, base)))
  ) {
    base = `${minute}-${scopeSlug}-${String(n).padStart(2, '0')}`;
    file = path.join(activeDir, `${base}.md`);
    n += 1;
  }

  const now = new Date().toISOString();
  const packetId = packetIdFromParts(branch, base);
  const body = `---
packet_id: ${packetId}
branch: ${branch}
scope: ${scopeSlug}
created: ${now}
updated: ${now}
last_anchor: review_handoff
lifecycle_state: in_progress
round: 1
loop: on
---

# Review Handoff

## Goal
- User request: review-loop auto loop handoff
- Intended behavior: packet-driven Fixer + headless Reviewer loop
- Non-goals: dual-window coordination; profile=deep blind review

## Review Scope
- Scope type: working tree / loop orchestration
- Repository: ${repoRoot}
- Branch: ${branch}
`;
  // Exclusive create (wx) to close TOCTOU window (F2)
  // Exclusive create with multi-retry against active/archive/runtime (F2)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tryBase =
      attempt === 0 ? base : `${minute}-${scopeSlug}-${String(n + attempt - 1).padStart(2, '0')}`;
    const tryFile = path.join(activeDir, `${tryBase}.md`);
    const tryId = packetIdFromParts(branch, tryBase);
    if (
      fs.existsSync(tryFile)
      || fs.existsSync(path.join(archiveDir, `${tryBase}.md`))
      || fs.existsSync(path.join(repoRoot, '.review-handoff', 'runtime', tryId))
    ) {
      continue;
    }
    const tryBody = body
      .replace(packetId, tryId)
      .replace(`scope: ${scopeSlug}`, `scope: ${scopeSlug}`);
    // ensure packet_id line correct
    const bodyFinal = `---
packet_id: ${tryId}
branch: ${branch}
scope: ${scopeSlug}
created: ${now}
updated: ${now}
last_anchor: review_handoff
lifecycle_state: in_progress
round: 1
loop: on
---

# Review Handoff

## Goal
- User request: review-loop auto loop handoff
- Intended behavior: packet-driven Fixer + headless Reviewer loop
- Non-goals: dual-window coordination; profile=deep blind review

## Review Scope
- Scope type: working tree / loop orchestration
- Repository: ${repoRoot}
- Branch: ${branch}
`;
    try {
      const fd = fs.openSync(tryFile, 'wx');
      fs.writeFileSync(fd, bodyFinal, 'utf8');
      fs.closeSync(fd);
      return { packetPath: tryFile, packetId: tryId, fileBase: tryBase };
    } catch (err) {
      if (err?.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('createPacketFile: exhausted unique name retries');
}

export function readPacketMeta(packetPath) {
  const text = fs.readFileSync(packetPath, 'utf8');
  const fm = parseFrontmatter(text);
  return {
    text,
    frontmatter: fm,
    lastAnchor: fm.last_anchor ?? null,
    lifecycleState: fm.lifecycle_state ?? 'in_progress',
    packetId: fm.packet_id ?? null,
    fingerprint: sha256(text),
  };
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = text.slice(4, end).trim();
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

export function rewriteFrontmatter(packetPath, updates) {
  const text = fs.readFileSync(packetPath, 'utf8');
  if (!text.startsWith('---')) throw new Error('packet missing frontmatter');
  const end = text.indexOf('\n---', 3);
  if (end === -1) throw new Error('packet frontmatter not closed');
  const body = text.slice(end + 4); // after \n---
  const fm = parseFrontmatter(text);
  Object.assign(fm, updates);
  fm.updated = new Date().toISOString();
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  const next = `---\n${lines.join('\n')}\n---${body.startsWith('\n') ? body : `\n${body}`}`;
  const tmp = temporarySibling(packetPath);
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, packetPath);
  return readPacketMeta(packetPath);
}

export function appendPacketSection(packetPath, markdownSection) {
  return appendStageAtEof(packetPath, {
    sectionMarkdown: markdownSection,
    // keep existing frontmatter anchors unless caller rewrites after
    preserveFrontmatter: true,
  });
}

/**
 * Atomic append-at-EOF for packet H1 sections.
 * This is the ONLY supported way for workers to add stages — never mid-file patch / fuzzy anchors.
 *
 * @param {string} packetPath
 * @param {{ sectionMarkdown: string, lastAnchor?: string, lifecycleState?: string, extra?: Record<string,string>, preserveFrontmatter?: boolean }} opts
 */
export function appendStageAtEof(packetPath, opts) {
  const section = String(opts.sectionMarkdown ?? '').trim();
  if (!section) throw new Error('appendStageAtEof: empty section');
  if (!/^# [^#\n]/.test(section)) {
    throw new Error('appendStageAtEof: section must start with a top-level H1 (# Title)');
  }

  const text = fs.readFileSync(packetPath, 'utf8');
  if (!text.startsWith('---')) throw new Error('packet missing frontmatter');
  const end = text.indexOf('\n---', 3);
  if (end === -1) throw new Error('packet frontmatter not closed');
  const body = text.slice(end + 4);
  const fm = parseFrontmatter(text);

  if (!opts.preserveFrontmatter) {
    if (!opts.lastAnchor) throw new Error('appendStageAtEof: lastAnchor required');
    if (!opts.lifecycleState) throw new Error('appendStageAtEof: lifecycleState required');
    Object.assign(fm, opts.extra ?? {}, {
      last_anchor: opts.lastAnchor,
      lifecycle_state: opts.lifecycleState,
      updated: new Date().toISOString(),
    });
  } else {
    fm.updated = new Date().toISOString();
    Object.assign(fm, opts.extra ?? {});
  }

  const newBody = `${String(body).replace(/\s*$/, '')}\n\n${section}\n`;
  const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  const next = `---\n${fmLines.join('\n')}\n---\n${newBody.replace(/^\n/, '')}`;
  const tmp = temporarySibling(packetPath);
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, packetPath);

  const meta = readPacketMeta(packetPath);
  const last = lastPhysicalH1(meta.text);
  if (!last) throw new Error('appendStageAtEof: no H1 after write');
  // Last H1 inside the appended chunk must be the packet's last physical H1
  // Fence-aware (N1): ignore `#` lines inside ``` / ~~~ code fences
  const appendedTitles = (() => {
    const lines = section.split('\n');
    /** @type {string[]} */
    const titles = [];
    let fenced = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const match = line.match(/^# ([^#].*?)\s*$/);
      if (match) titles.push(match[1].trim());
    }
    return titles;
  })();
  const expectedTitle = appendedTitles.at(-1);
  if (!expectedTitle) throw new Error('appendStageAtEof: section has no H1');
  if (last.title !== expectedTitle && last.anchor !== normalizeH1(expectedTitle)) {
    throw new Error(
      `appendStageAtEof integrity failed: expected last H1 "${expectedTitle}", got "${last.title}"`,
    );
  }
  if (!opts.preserveFrontmatter && meta.lastAnchor !== opts.lastAnchor) {
    throw new Error(
      `appendStageAtEof frontmatter last_anchor mismatch: expected ${opts.lastAnchor}, got ${meta.lastAnchor}`,
    );
  }
  return meta;
}

/** Return last physical top-level H1 in packet body (fenced code aware). */
export function lastPhysicalH1(packetText) {
  const sections = parseH1Sections(packetText);
  return sections.at(-1) ?? null;
}

export function listPhysicalH1s(packetText) {
  return parseH1Sections(packetText).map((s) => ({ title: s.title, anchor: s.anchor }));
}

export function archivePacket(packetPath) {
  const normalized = packetPath.split(path.sep).join('/');
  const marker = '/.review-handoff/active/';
  const index = normalized.indexOf(marker);
  if (index === -1) throw new Error('only active packets can be archived');
  const archivePath = `${normalized.slice(0, index)}/.review-handoff/archive/${normalized.slice(index + marker.length)}`;
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.renameSync(packetPath, archivePath);
  return archivePath;
}

/** Half-write: write incomplete content without final frontmatter update (for tests). */
export function halfWritePacket(packetPath, incompleteTail) {
  fs.appendFileSync(packetPath, incompleteTail, 'utf8');
}

export function runtimeDir(repoRoot, packetId) {
  const segments = validatePacketId(packetId);
  const root = path.resolve(repoRoot, '.review-handoff', 'runtime');
  const dir = path.resolve(root, ...segments);
  assertContained(root, dir, 'runtime path');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = temporarySibling(file);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * @param {string} repoRoot
 * @param {string} branch
 * @param {string} packetPath
 * @param {{ activeOnly?: boolean }} [opts]
 */
export function validatePacketPath(repoRoot, branch, packetPath, opts = {}) {
  const resolved = fs.realpathSync(packetPath);
  const resolvedRepoRoot = fs.realpathSync(repoRoot);
  const branchDir = branchSlug(branch);
  const locations = opts.activeOnly ? ['active'] : ['active', 'archive'];
  const allowedRoots = locations.map((location) =>
    path.resolve(resolvedRepoRoot, '.review-handoff', location, branchDir),
  );
  if (!allowedRoots.some((root) => isContained(root, resolved))) {
    throw new Error(
      opts.activeOnly
        ? `packet must be under .review-handoff/active/${branchDir} (writes refuse archive)`
        : `packet must be under .review-handoff/active/${branchDir} or .review-handoff/archive/${branchDir}`,
    );
  }
  const meta = readPacketMeta(resolved);
  const expectedId = packetIdFromParts(branch, path.basename(resolved, '.md'));
  if (meta.packetId !== expectedId) {
    throw new Error(`packet_id mismatch: expected ${expectedId}, got ${meta.packetId ?? '<missing>'}`);
  }
  if (meta.frontmatter.branch !== branch) {
    throw new Error(`packet branch mismatch: expected ${branch}, got ${meta.frontmatter.branch ?? '<missing>'}`);
  }
  validatePacketId(meta.packetId);
  return { packetPath: resolved, packetId: expectedId, meta };
}

export function withRuntimeLock(repoRoot, packetId, operation, { timeoutMs = 5000 } = {}) {
  const lockDir = path.join(runtimeDir(repoRoot, packetId), '.kernel.lock');
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(`runtime lock timeout for packet ${packetId}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    return operation();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

export function appendEvent(repoRoot, packetId, event) {
  const dir = runtimeDir(repoRoot, packetId);
  const file = path.join(dir, 'events.jsonl');
  fs.appendFileSync(file, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function localMinuteStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

export function validateCompletedStage({ packetPath, meta, role }) {
  const sections = parseH1Sections(meta.text);
  const last = sections.at(-1);
  if (!last) throw new Error('packet body has no H1 stage');
  if (last.anchor !== meta.lastAnchor) {
    throw new Error(
      `last physical H1 is ${last.anchor}, but frontmatter last_anchor is ${meta.lastAnchor}. ` +
        `Likely mid-file packet edit — discard that insert; write only via review-loop run / fix-completion (auto stage writer).`,
    );
  }

  const location = packetLocation(packetPath);
  validateLifecycleTuple({ meta, location, sections });

  if (meta.lastAnchor === 'fix_handoff') {
    if (role !== 'reviewer') throw new Error('only Reviewer may complete Fix Handoff');
    const findings = sections.at(-2);
    if (findings?.anchor !== 'review_findings') {
      throw new Error('Fix Handoff must immediately follow Review Findings in the same stage group');
    }
    requireH2(findings, ['scope reviewed', 'verification', 'findings', 'verdict']);
    requireH2(last, [
      'scope',
      'validated findings to fix',
      'constraints',
      'verification required',
      'required fix agent output',
    ]);
    const verdict = sectionVerdict(findings);
    if (!['BLOCKED', 'PASS_WITH_CONCERNS'].includes(verdict)) {
      throw new Error(`Fix Handoff requires BLOCKED or PASS_WITH_CONCERNS, got ${verdict || '<missing>'}`);
    }
  } else if (meta.lastAnchor === 'review_findings') {
    if (role !== 'reviewer') throw new Error('only Reviewer may complete Review Findings');
    requireH2(last, ['scope reviewed', 'verification', 'findings', 'verdict']);
  } else if (meta.lastAnchor === 'fix_completion') {
    if (role !== 'fixer') throw new Error('only Fixer may complete Fix Completion');
    const h2 = sectionH2(last);
    if (h2.at(0) !== 'fix conclusion') {
      throw new Error('Fix Completion first subsection must be Fix Conclusion');
    }
    requireH2(last, [
      'fix conclusion',
      'original findings snapshot',
      'finding status',
      'verification',
      're-review instructions',
    ]);
  } else if (meta.lastAnchor === 're_review') {
    if (role !== 'reviewer') throw new Error('only Reviewer may complete Re-review');
    const h2 = sectionH2(last);
    if (!h2.some((heading) => heading.startsWith('scope'))) {
      throw new Error('Re-review missing Scope subsection');
    }
    requireH2(last, ['prior findings reassessment', 'new findings', 'regression surface', 'verdict']);
  } else {
    throw new Error(`unsupported completed stage: ${meta.lastAnchor ?? '<missing>'}`);
  }
  return { ok: true, lastAnchor: meta.lastAnchor, lifecycleState: meta.lifecycleState };
}

function validateLifecycleTuple({ meta, location, sections }) {
  const anchor = meta.lastAnchor;
  const lifecycle = meta.lifecycleState;
  const last = sections.at(-1);
  const verdict = sectionVerdict(last);
  // Auto-loop contract: BLOCKED Fix Handoff → blocked; Fix Completion mid-fix → in_progress
  if (anchor === 'fix_handoff') {
    if (location !== 'active' || (lifecycle !== 'blocked' && lifecycle !== 'in_progress')) {
      throw new Error(
        `fix_handoff requires lifecycle_state=blocked (or in_progress) under active/ (got ${lifecycle}/${location})`,
      );
    }
    return;
  }
  if (anchor === 'fix_completion') {
    if (lifecycle !== 'in_progress' || location !== 'active') {
      throw new Error(`${anchor} requires lifecycle_state=in_progress under active/`);
    }
    return;
  }
  if (anchor === 'review_findings') {
    const terminal = ['PASS', 'NO_FINDINGS'].includes(verdict);
    if (terminal && (lifecycle !== 'archived' || location !== 'archive')) {
      throw new Error('terminal Review Findings requires lifecycle_state=archived under archive/');
    }
    if (verdict === 'PASS_WITH_CONCERNS') {
      if (lifecycle !== 'awaiting_user_decision' || location !== 'active') {
        throw new Error(
          'PASS_WITH_CONCERNS Review Findings requires lifecycle_state=awaiting_user_decision under active/',
        );
      }
      return;
    }
    if (verdict === 'BLOCKED') {
      if (location !== 'active' || (lifecycle !== 'blocked' && lifecycle !== 'in_progress')) {
        throw new Error(
          'BLOCKED Review Findings requires lifecycle_state=blocked under active/',
        );
      }
      return;
    }
    if (!terminal && (lifecycle !== 'in_progress' || location !== 'active')) {
      throw new Error('non-terminal Review Findings requires lifecycle_state=in_progress under active/');
    }
    return;
  }
  if (anchor === 're_review') {
    const expected =
      verdict === 'PASS' || verdict === 'NO_FINDINGS'
        ? ['archived', 'archive']
        : verdict === 'PASS_WITH_CONCERNS'
          ? ['awaiting_user_decision', 'active']
          : verdict === 'BLOCKED'
            ? ['blocked', 'active']
            : null;
    if (!expected || lifecycle !== expected[0] || location !== expected[1]) {
      throw new Error(
        `Re-review verdict/lifecycle/location mismatch: ${verdict || '<missing>'}/${lifecycle}/${location}`,
      );
    }
  }
}

function parseH1Sections(text) {
  const lines = text.split('\n');
  const headings = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^# ([^#].*?)\s*$/);
    if (match) headings.push({ index, title: match[1], anchor: normalizeH1(match[1]) });
  }
  return headings.map((heading, index) => ({
    ...heading,
    body: lines.slice(heading.index + 1, headings[index + 1]?.index ?? lines.length).join('\n'),
  }));
}

function sectionH2(section) {
  return sectionH2Blocks(section).map((block) => block.heading);
}

function requireH2(section, required) {
  const blocks = sectionH2Blocks(section);
  const missing = required.filter(
    (heading) => !blocks.some((block) => block.heading === heading),
  );
  if (missing.length) {
    throw new Error(`${section.title} missing required subsections: ${missing.join(', ')}`);
  }
  const empty = required.filter(
    (heading) =>
      !blocks.some((block) => block.heading === heading && block.body.trim().length > 0),
  );
  if (empty.length) {
    throw new Error(`${section.title} has empty required subsections: ${empty.join(', ')}`);
  }
}

function sectionH2Blocks(section) {
  const lines = unfencedLines(section.body);
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^## ([^#].*?)\s*$/);
    if (match) headings.push({ index, heading: match[1].trim().toLowerCase() });
  }
  return headings.map((heading, index) => ({
    ...heading,
    body: lines.slice(heading.index + 1, headings[index + 1]?.index ?? lines.length).join('\n'),
  }));
}

function parseMarkdownTable(body) {
  const rows = body
    .split('\n')
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim()));
  if (rows.length < 2) return { headers: [], rows: [] };
  const headers = rows[0].map((cell) => cell.toLowerCase());
  const separator = rows[1];
  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return { headers: [], rows: [] };
  }
  return { headers, rows: rows.slice(2).filter((row) => row.length === headers.length) };
}

function sectionVerdict(section) {
  if (!section) return null;
  const physicalBody = unfencedLines(section.body).join('\n');
  const match = physicalBody.match(/(?:^|\n)## Verdict\s*\n+\s*(BLOCKED|PASS_WITH_CONCERNS|PASS|NO_FINDINGS)\s*(?:\n|$)/);
  return match?.[1] ?? null;
}

function unfencedLines(text) {
  const lines = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line);
  }
  return lines;
}

function normalizeH1(title) {
  return title
    .replace(/ \(round \d+\)$/i, '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Public: normalize stage titles / CLI --stage into frontmatter anchors. */
export function stageAnchor(name) {
  return normalizeH1(String(name ?? ''));
}

function packetLocation(packetPath) {
  const normalized = packetPath.split(path.sep).join('/');
  if (normalized.includes('/.review-handoff/active/')) return 'active';
  if (normalized.includes('/.review-handoff/archive/')) return 'archive';
  return 'outside';
}

function validatePacketId(packetId) {
  if (typeof packetId !== 'string' || path.isAbsolute(packetId)) {
    throw new Error(`invalid packet_id: ${packetId}`);
  }
  const segments = packetId.split('/');
  if (
    segments.length !== 2
    || segments.some(
      (segment) =>
        !segment
        || segment === '.'
        || segment === '..'
        || !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    throw new Error(`invalid packet_id: ${packetId}`);
  }
  return segments;
}

function temporarySibling(file) {
  return `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertContained(root, candidate, label) {
  if (!isContained(root, candidate)) throw new Error(`${label} escapes ${root}`);
}


