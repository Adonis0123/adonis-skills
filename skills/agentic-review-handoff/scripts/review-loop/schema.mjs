/**
 * Fail-closed Reviewer output parsers for auto loop.
 *
 * Round 1 (Review Findings): findings + Verdict
 * Round ≥2 (Re-review): prior reassessment + New Findings + Regression Surface + Verdict
 */

const VERDICTS = new Set(['PASS', 'PASS_WITH_CONCERNS', 'BLOCKED', 'NO_FINDINGS']);

/**
 * Extract last non-empty line matching Verdict.
 * Accepts:
 *   Verdict: PASS
 *   ## Verdict\nPASS
 *   **Verdict:** BLOCKED
 * @param {string} text
 * @returns {string|null}
 */
export function extractVerdict(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // Prefer explicit last Verdict line
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    let m = line.match(/^(?:\*\*)?Verdict(?:\*\*)?\s*[:：]\s*(PASS_WITH_CONCERNS|PASS|BLOCKED|NO_FINDINGS)\b/i);
    if (m) return m[1].toUpperCase();
    m = line.match(/^(PASS_WITH_CONCERNS|PASS|BLOCKED|NO_FINDINGS)$/i);
    if (m) {
      // only if previous line looks like a Verdict heading
      const prev = lines[i - 1] ?? '';
      if (/verdict/i.test(prev) || i === lines.length - 1) {
        // bare verdict as last line is accepted when it's the terminal line
        if (i === lines.length - 1 || /verdict/i.test(prev)) {
          return m[1].toUpperCase();
        }
      }
    }
  }
  // Fallback: scan for "## Verdict" block
  const block = String(text).match(/##\s*Verdict\s*\n+\s*(PASS_WITH_CONCERNS|PASS|BLOCKED|NO_FINDINGS)\b/i);
  if (block) return block[1].toUpperCase();
  return null;
}

/**
 * Parse a markdown pipe table into rows of objects keyed by header.
 * @param {string} text
 * @returns {{ headers: string[], rows: Record<string,string>[] }}
 */
export function parseMarkdownTables(text) {
  const lines = String(text).split('\n');
  /** @type {{ headers: string[], rows: Record<string,string>[] }[]} */
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const headerCells = splitRow(lines[i]);
    if (!headerCells.length) continue;
    const next = lines[i + 1] ?? '';
    if (!/^\s*\|?\s*:?-{3,}/.test(next)) continue;
    const headers = headerCells.map(normalizeHeader);
    /** @type {Record<string,string>[]} */
    const rows = [];
    i += 2;
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      const cells = splitRow(lines[i]);
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        i += 1;
        continue;
      }
      /** @type {Record<string,string>} */
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (cells[idx] ?? '').trim();
      });
      rows.push(row);
      i += 1;
    }
    i -= 1;
    tables.push({ headers, rows });
  }
  return tables;
}

function splitRow(line) {
  const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return raw.split('|').map((c) => c.trim());
}

function normalizeHeader(h) {
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @param {Record<string,string>} row
 */
export function findingFromRow(row) {
  const id = row.id || row['finding id'] || row['finding_id'] || '';
  const severity = row['严重度'] || row.severity || row['sev'] || '';
  const title = row['标题'] || row.title || row.summary || '';
  const evidence = row['证据'] || row.evidence || '';
  const target = row['target files'] || row['target file'] || row.files || row['target'] || '';
  const required = row['required fix'] || row.fix || row['required'] || '';
  const acceptance = row['acceptance check'] || row.acceptance || row['check'] || '';
  return {
    id: String(id).trim(),
    severity: String(severity).trim(),
    title: String(title).trim(),
    evidence: String(evidence).trim(),
    targetFiles: String(target).trim(),
    requiredFix: String(required).trim(),
    acceptanceCheck: String(acceptance).trim(),
    blocking: /阻塞|blocking|blocker/i.test(severity) && !/非阻塞|non-?blocking/i.test(severity),
  };
}

/**
 * Validate first-round Review Findings output.
 * @param {string} text
 * @returns {{ ok: true, verdict: string, findings: ReturnType<typeof findingFromRow>[] } | { ok: false, error: string }}
 */
export function parseReviewFindings(text) {
  const verdict = extractVerdict(text);
  if (!verdict || !VERDICTS.has(verdict)) {
    return { ok: false, error: 'missing or invalid Verdict (expected PASS|PASS_WITH_CONCERNS|BLOCKED|NO_FINDINGS)' };
  }

  const tables = parseMarkdownTables(text);
  /** @type {ReturnType<typeof findingFromRow>[]} */
  let findings = [];
  for (const t of tables) {
    const hasId = t.headers.some((h) => h === 'id' || h === 'finding id');
    if (!hasId) continue;
    findings = t.rows.map(findingFromRow).filter((f) => f.id);
    if (findings.length) break;
  }

  // PASS / NO_FINDINGS may have zero findings
  if (verdict === 'BLOCKED' || verdict === 'PASS_WITH_CONCERNS') {
    if (!findings.length) {
      return { ok: false, error: `${verdict} requires at least one finding row with ID` };
    }
    for (const f of findings) {
      if (!f.title || !f.severity) {
        return { ok: false, error: `finding ${f.id} missing title or severity` };
      }
      if (!f.evidence || !f.requiredFix || !f.acceptanceCheck) {
        return {
          ok: false,
          error: `finding ${f.id} missing evidence/required fix/acceptance check`,
        };
      }
    }
  }

  if (verdict === 'PASS_WITH_CONCERNS') {
    const blocking = findings.filter((f) => f.blocking);
    if (blocking.length) {
      return {
        ok: false,
        error: 'PASS_WITH_CONCERNS only allowed when all remaining findings are non-blocking',
      };
    }
  }

  if (verdict === 'BLOCKED') {
    const blocking = findings.filter((f) => f.blocking);
    if (!blocking.length) {
      return { ok: false, error: 'BLOCKED requires at least one [阻塞] finding' };
    }
  }

  return { ok: true, verdict, findings };
}

/**
 * Validate re-review output (round ≥ 2).
 * @param {string} text
 * @param {string[]} priorFindingIds
 */
export function parseReReview(text, priorFindingIds = []) {
  const verdict = extractVerdict(text);
  if (!verdict || !VERDICTS.has(verdict)) {
    return { ok: false, error: 'missing or invalid Verdict on re-review' };
  }

  // Prior findings reassessment: need status per prior ID when priors exist
  const lower = String(text).toLowerCase();
  if (!/prior findings reassessment|prior finding|复评|reassessment/i.test(text) && priorFindingIds.length) {
    return { ok: false, error: 're-review missing Prior Findings Reassessment section' };
  }
  if (!/new findings/i.test(lower) && !/新增/i.test(text)) {
    // allow empty new findings if section header present
    if (!/##\s*new findings/i.test(text)) {
      return { ok: false, error: 're-review missing New Findings section' };
    }
  }
  if (!/regression surface/i.test(lower) && !/回归/i.test(text)) {
    return { ok: false, error: 're-review missing Regression Surface section' };
  }

  /** @type {{ id: string, status: string, evidence: string }[]} */
  const reassessments = [];
  const tables = parseMarkdownTables(text);
  for (const t of tables) {
    const idKey = t.headers.find((h) => h === 'id' || h === 'finding id');
    const statusKey = t.headers.find((h) => /status|状态|result/.test(h));
    if (!idKey || !statusKey) continue;
    // Prefer reassessment tables (have status values resolved|partial|unresolved)
    for (const row of t.rows) {
      const id = row[idKey];
      const status = row[statusKey];
      if (!id) continue;
      if (/resolved|partial|unresolved|fixed|open/i.test(status)) {
        reassessments.push({
          id,
          status,
          evidence: row.evidence || row['复核证据'] || row['evidence'] || '',
        });
      }
    }
  }

  if (priorFindingIds.length) {
    for (const id of priorFindingIds) {
      if (!reassessments.some((r) => r.id === id)) {
        return { ok: false, error: `re-review missing reassessment for prior finding ${id}` };
      }
    }
  }

  // New findings table (optional rows)
  /** @type {ReturnType<typeof findingFromRow>[]} */
  let newFindings = [];
  // Heuristic: table after "New Findings" heading
  const newSection = String(text).split(/##\s*New Findings/i)[1] ?? '';
  if (newSection) {
    const beforeNext = newSection.split(/##\s+/)[0];
    const nt = parseMarkdownTables(beforeNext);
    for (const t of nt) {
      if (t.headers.some((h) => h === 'id' || h === 'finding id')) {
        newFindings = t.rows.map(findingFromRow).filter((f) => f.id);
        break;
      }
    }
  }

  return {
    ok: true,
    verdict,
    reassessments,
    newFindings,
  };
}

/**
 * Convert parsed first-round findings into packet markdown stages.
 * @param {{ verdict: string, findings: ReturnType<typeof findingFromRow>[], reviewer: string, baseSha: string, evidencePath: string }} parsed
 */
export function formatReviewFindingsStage(parsed) {
  const { verdict, findings, reviewer, baseSha, evidencePath } = parsed;
  const rows =
    findings.length === 0
      ? '| (none) | — | No findings | — | — | — | — |'
      : findings
          .map(
            (f) =>
              `| ${f.id} | ${f.severity} | ${f.title} | ${f.evidence} | ${f.targetFiles} | ${f.requiredFix} | ${f.acceptanceCheck} |`,
          )
          .join('\n');

  let md = `# Review Findings

> reviewer: ${reviewer}
> base_sha: ${baseSha}
> evidence: ${evidencePath}

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
${rows}

## Verdict

${verdict}
`;

  if (verdict === 'BLOCKED' || verdict === 'PASS_WITH_CONCERNS') {
    const handoffRows = findings
      .map(
        (f) =>
          `| ${f.id} | ${f.severity} | ${f.title} | ${f.targetFiles} | ${f.requiredFix} | ${f.acceptanceCheck} |`,
      )
      .join('\n');
    md += `
# Fix Handoff

| ID | 严重度 | 标题 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|
${handoffRows}
`;
  }
  return md.trim() + '\n';
}

/**
 * @param {{
 *   verdict: string,
 *   reassessments: {id:string,status:string,evidence:string}[],
 *   newFindings: ReturnType<typeof findingFromRow>[],
 *   reviewer: string,
 *   round: number,
 *   evidencePath: string,
 * }} parsed
 */
export function formatReReviewStage(parsed) {
  const title = parsed.round > 2 ? `# Re-review (round ${parsed.round})` : '# Re-review';
  const reRows =
    parsed.reassessments.length === 0
      ? '| (none) | — | — |'
      : parsed.reassessments
          .map((r) => `| ${r.id} | ${r.status} | ${r.evidence || '—'} |`)
          .join('\n');
  const newRows =
    parsed.newFindings.length === 0
      ? '| (none) | — | — | — | — | — | — |'
      : parsed.newFindings
          .map(
            (f) =>
              `| ${f.id} | ${f.severity} | ${f.title} | ${f.evidence} | ${f.targetFiles} | ${f.requiredFix} | ${f.acceptanceCheck} |`,
          )
          .join('\n');

  return `${title}

> reviewer: ${parsed.reviewer}
> evidence: ${parsed.evidencePath}

## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
${reRows}

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
${newRows}

## Regression Surface

No load-bearing regressions identified beyond listed findings.

## Verdict

${parsed.verdict}
`;
}

/**
 * Lifecycle for auto loop given verdict + stage.
 * @param {'review_findings'|'re_review'} stage
 * @param {string} verdict
 */
export function lifecycleForVerdict(stage, verdict) {
  const v = String(verdict).toUpperCase();
  if (v === 'PASS' || v === 'NO_FINDINGS') return 'archived';
  if (v === 'PASS_WITH_CONCERNS') return 'awaiting_user_decision';
  if (v === 'BLOCKED') return 'blocked';
  return 'in_progress';
}

export { VERDICTS };
