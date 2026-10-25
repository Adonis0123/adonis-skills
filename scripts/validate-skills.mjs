import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  CATALOG_FILE,
  ILLUSTRATIONS_DIR,
  findCatalogIssues,
} from "../apps/web/src/lib/skill-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skillsDir = path.join(root, "skills");
const agentsSkillsDir = path.join(root, ".agents/skills");

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;

  return YAML.parse(match[1]) || {};
}

// Agent Skills spec (agentskills.io/specification) and Claude's skill authoring
// guide: description is 1-1024 characters and cannot contain XML tags.
export const DESCRIPTION_MAX_LENGTH = 1024;

export function descriptionProblems(rawDescription) {
  const description = rawDescription.trim();
  const problems = [];
  if (description.length < 20)
    problems.push(
      "frontmatter.description 过短（至少 20 字符，供工具选择器展示）",
    );
  if (description.length > DESCRIPTION_MAX_LENGTH)
    problems.push(
      `frontmatter.description 有 ${description.length} 字符，超过 Agent Skills 上限 ${DESCRIPTION_MAX_LENGTH}；删掉重复的触发词或把细节移进 SKILL.md 正文`,
    );
  const tags = description.match(/<\/?[A-Za-z][^<>]*>/g);
  if (tags)
    problems.push(
      `frontmatter.description 含 XML 标签 ${tags.join(" ")}，Agent Skills 不允许；改用不带尖括号的写法（如 URL 代替 <url>）`,
    );
  return problems;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const errors = [];
  const slugs = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !entry.name.endsWith("-workspace"),
    )
    .map((entry) => entry.name);

  let catalog;
  try {
    catalog = YAML.parse(
      await fs.readFile(path.join(root, CATALOG_FILE), "utf8"),
    );
  } catch (error) {
    errors.push(`${CATALOG_FILE} 无法读取或不是合法 YAML：${error.message}`);
  }
  if (catalog !== undefined) {
    const illustrations = (await exists(path.join(root, ILLUSTRATIONS_DIR)))
      ? await fs.readdir(path.join(root, ILLUSTRATIONS_DIR))
      : [];
    errors.push(...findCatalogIssues(slugs, catalog, { illustrations }));
  }

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      entry.name.endsWith("-workspace")
    )
      continue;

    const skillPath = path.join(skillsDir, entry.name);
    const skillFile = path.join(skillPath, "SKILL.md");

    let content;
    try {
      content = await fs.readFile(skillFile, "utf8");
    } catch {
      errors.push(`[${entry.name}] 缺少 SKILL.md`);
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      errors.push(`[${entry.name}] SKILL.md 缺少 frontmatter`);
      continue;
    }

    if (typeof frontmatter.name !== "string" || !frontmatter.name.trim()) {
      errors.push(`[${entry.name}] frontmatter.name 不能为空`);
    } else if (frontmatter.name !== entry.name) {
      // Directory slug is the public skill id; name must match for install/index.
      errors.push(
        `[${entry.name}] frontmatter.name (${frontmatter.name}) 必须与目录名一致`,
      );
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name)) {
      errors.push(
        `[${entry.name}] frontmatter.name 必须是 lowercase hyphen-case`,
      );
    }

    if (
      typeof frontmatter.description !== "string" ||
      !frontmatter.description.trim()
    ) {
      errors.push(`[${entry.name}] frontmatter.description 不能为空`);
    } else {
      for (const problem of descriptionProblems(frontmatter.description))
        errors.push(`[${entry.name}] ${problem}`);
    }

    if (
      typeof frontmatter.metadata !== "object" ||
      frontmatter.metadata === null ||
      Array.isArray(frontmatter.metadata)
    )
      errors.push(`[${entry.name}] frontmatter.metadata 必须是一个对象`);
    else if (
      typeof frontmatter.metadata.author !== "string" ||
      !frontmatter.metadata.author.trim()
    )
      errors.push(`[${entry.name}] frontmatter.metadata.author 不能为空`);

    // Mirror guard scope is intentionally narrow:
    // only enforce the reserved pages-router placeholder that is required by SKILL.md.
    // This is not a full directory diff between skills/ and .agents/skills.
    const reservedTemplateFile = path.join(
      skillPath,
      "assets/templates/pages-router/_reserved.tpl",
    );
    const agentSkillPath = path.join(agentsSkillsDir, entry.name);
    const agentReservedTemplateFile = path.join(
      agentSkillPath,
      "assets/templates/pages-router/_reserved.tpl",
    );

    if (
      (await exists(reservedTemplateFile)) &&
      (await exists(agentSkillPath)) &&
      !(await exists(agentReservedTemplateFile))
    ) {
      errors.push(
        `[${entry.name}] .agents 镜像缺少文件: ${agentReservedTemplateFile}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Skills 校验失败:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("Skills 校验通过");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
