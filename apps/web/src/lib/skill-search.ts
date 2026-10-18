import type { SkillListItem, SkillTag } from "@/lib/skill-schema";

export type TagLabels = Record<SkillTag, readonly string[]>;

interface Field {
  text: string;
  weight: number;
}

// Full-width CJK punctuation is listed too: NFKC folds ，；：！？（） to ASCII,
// but 。、【】「」《》“”‘’ survive normalization unchanged.
const WORD_SPLIT =
  /[\s,.;:!?()[\]{}"'`/\\|_\-，。、；：！？（）【】「」《》“”‘’　]+/;

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKC");
}

// True when `a` and `b` differ by at most one insert, delete, substitution, or
// swap of two adjacent letters ("reveiw" -> "review").
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length === b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      i += 2;
      j += 2;
    } else if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatches(token: string, field: string, words: string[]): boolean {
  if (field.includes(token)) return true;
  // Typo tolerance only for Latin words long enough to be unambiguous.
  if (token.length < 4 || !/^[a-z0-9]+$/.test(token)) return false;
  return words.some((word) => word.length >= 4 && withinOneEdit(token, word));
}

function fieldsOf(skill: SkillListItem, tagLabels: TagLabels): Field[] {
  const { catalog } = skill;
  return [
    { text: `${skill.name} ${skill.slug}`, weight: 8 },
    {
      text: catalog.tags.flatMap((tag) => [tag, ...tagLabels[tag]]).join(" "),
      weight: 5,
    },
    { text: `${catalog.summary} ${catalog.summary_zh}`, weight: 4 },
    {
      text: [...catalog.use_cases, ...catalog.use_cases_zh].join(" "),
      weight: 2,
    },
    { text: skill.description, weight: 1 },
  ].map((field) => ({ ...field, text: normalize(field.text) }));
}

/** Splits a query into lowercase tokens; CJK runs stay whole and match as substrings. */
export function tokenizeQuery(query: string): string[] {
  return normalize(query)
    .split(WORD_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Filters and ranks skills: every token must match some field (AND), and
 * matches in the name, tags, and summaries outrank matches in the long
 * model-facing description. Ties keep the incoming order.
 */
export function searchSkills(
  skills: readonly SkillListItem[],
  query: string,
  tagLabels: TagLabels,
): SkillListItem[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [...skills];

  const scored: Array<{ skill: SkillListItem; score: number; index: number }> =
    [];

  skills.forEach((skill, index) => {
    const fields = fieldsOf(skill, tagLabels).map((field) => ({
      ...field,
      words: field.text.split(WORD_SPLIT),
    }));
    let score = 0;
    for (const token of tokens) {
      const best = fields.reduce(
        (max, field) =>
          tokenMatches(token, field.text, field.words)
            ? Math.max(max, field.weight)
            : max,
        0,
      );
      if (best === 0) return;
      score += best;
    }
    scored.push({ skill, score, index });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.skill);
}
