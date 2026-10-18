import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  CATALOG_FILE,
  catalogLayoutSchema,
  findCatalogIssues,
  skillDetailListSchema,
  skillListSchema,
} from "../apps/web/src/lib/skill-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skillsDir = path.join(root, "skills");
const listOutputPath = path.join(
  root,
  "apps/web/src/generated/skills-index-lite.json",
);
const detailOutputPath = path.join(
  root,
  "apps/web/src/generated/skills-detail-index.json",
);
const layoutOutputPath = path.join(
  root,
  "apps/web/src/generated/skills-catalog-layout.json",
);

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return {};
  return YAML.parse(match[1]) || {};
}

// CommonMark fence: up to 3 spaces of indent, then 3+ backticks or tildes.
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function parseSections(content) {
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1].trim() : "";
  if (!body) return [];

  const lines = body.split("\n");
  const sections = [];
  let currentHeading = undefined;
  let currentLevel = undefined;
  let currentLines = [];
  let openFence = null;

  const flush = () => {
    const raw = currentLines.join("\n").trim();
    // Keep a heading even when its body is empty (e.g. `## A` directly
    // followed by `### B`); otherwise the heading vanishes from the page.
    if (!raw && currentHeading === undefined) return;
    const section = { raw };
    if (currentHeading !== undefined) {
      section.heading = currentHeading;
      section.level = currentLevel;
    }
    sections.push(section);
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_PATTERN);
    if (openFence) {
      // A closing fence uses the same character, is at least as long, and
      // carries no info string.
      if (
        fenceMatch &&
        fenceMatch[1][0] === openFence[0] &&
        fenceMatch[1].length >= openFence.length &&
        !fenceMatch[2].trim()
      )
        openFence = null;
      currentLines.push(line);
      continue;
    }
    // Backtick fences cannot have backticks in their info string.
    if (
      fenceMatch &&
      !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))
    ) {
      openFence = fenceMatch[1];
      currentLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} must be a non-empty string`);

  return value.trim();
}

function normalizeShowcase(value, slug) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`[${slug}] showcase.yaml must contain an object`);

  const hero = value.hero;
  if (!hero || typeof hero !== "object" || Array.isArray(hero))
    throw new Error(`[${slug}] showcase.hero must contain an object`);

  if (!Array.isArray(hero.keyMoments) || hero.keyMoments.length === 0)
    throw new Error(
      `[${slug}] showcase.hero.keyMoments must be a non-empty array`,
    );

  if (!Array.isArray(value.sections) || value.sections.length === 0)
    throw new Error(`[${slug}] showcase.sections must be a non-empty array`);

  return {
    hero: {
      title: requireString(hero.title, `[${slug}] showcase.hero.title`),
      badge: requireString(hero.badge, `[${slug}] showcase.hero.badge`),
      summary: requireString(hero.summary, `[${slug}] showcase.hero.summary`),
      keyMoments: hero.keyMoments.map((moment, index) =>
        requireString(moment, `[${slug}] showcase.hero.keyMoments[${index}]`),
      ),
    },
    sections: value.sections.map((section, sectionIndex) => {
      if (!section || typeof section !== "object" || Array.isArray(section))
        throw new Error(
          `[${slug}] showcase.sections[${sectionIndex}] must contain an object`,
        );

      if (!Array.isArray(section.messages) || section.messages.length === 0)
        throw new Error(
          `[${slug}] showcase.sections[${sectionIndex}].messages must be a non-empty array`,
        );

      return {
        id: requireString(
          section.id,
          `[${slug}] showcase.sections[${sectionIndex}].id`,
        ),
        title: requireString(
          section.title,
          `[${slug}] showcase.sections[${sectionIndex}].title`,
        ),
        intro: requireString(
          section.intro,
          `[${slug}] showcase.sections[${sectionIndex}].intro`,
        ),
        messages: section.messages.map((message, messageIndex) => {
          if (!message || typeof message !== "object" || Array.isArray(message))
            throw new Error(
              `[${slug}] showcase.sections[${sectionIndex}].messages[${messageIndex}] must contain an object`,
            );

          const role = requireString(
            message.role,
            `[${slug}] showcase.sections[${sectionIndex}].messages[${messageIndex}].role`,
          );
          if (role !== "user" && role !== "assistant")
            throw new Error(
              `[${slug}] showcase message role must be user or assistant`,
            );

          if (
            message.toolCalls !== undefined &&
            !Array.isArray(message.toolCalls)
          )
            throw new Error(
              `[${slug}] showcase message toolCalls must be an array`,
            );

          const toolCalls =
            message.toolCalls === undefined
              ? undefined
              : message.toolCalls.map((toolCall, toolIndex) => {
                  if (
                    !toolCall ||
                    typeof toolCall !== "object" ||
                    Array.isArray(toolCall)
                  )
                    throw new Error(
                      `[${slug}] showcase tool call must contain an object`,
                    );

                  return {
                    name: requireString(
                      toolCall.name,
                      `[${slug}] showcase toolCalls[${toolIndex}].name`,
                    ),
                    summary: requireString(
                      toolCall.summary,
                      `[${slug}] showcase toolCalls[${toolIndex}].summary`,
                    ),
                    result: requireString(
                      toolCall.result,
                      `[${slug}] showcase toolCalls[${toolIndex}].result`,
                    ),
                  };
                });

          return {
            role,
            content: requireString(
              message.content,
              `[${slug}] showcase.sections[${sectionIndex}].messages[${messageIndex}].content`,
            ),
            ...(toolCalls?.length ? { toolCalls } : {}),
          };
        }),
      };
    }),
  };
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readGitUpdatedAt(slug) {
  try {
    const gitOut = execFileSync(
      "git",
      ["log", "-1", "--format=%ci", "--", `skills/${slug}/`],
      { cwd: root, encoding: "utf8" },
    ).trim();
    return gitOut ? new Date(gitOut).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

// Shallow clones (CI, Vercel) only see the latest commit, so `git log` would
// stamp every skill with the same date. Reuse the committed dates instead.
async function loadCommittedUpdatedAt() {
  try {
    const shallow = execFileSync(
      "git",
      ["rev-parse", "--is-shallow-repository"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    if (shallow !== "true") return null;

    const committed = JSON.parse(await fs.readFile(listOutputPath, "utf8"));
    return new Map(committed.map((item) => [item.slug, item.updatedAt]));
  } catch {
    return null;
  }
}

async function loadCatalog(slugs) {
  const catalog = YAML.parse(
    await fs.readFile(path.join(root, CATALOG_FILE), "utf8"),
  );
  const issues = findCatalogIssues(slugs, catalog);
  if (issues.length > 0)
    throw new Error(`Skill catalog is invalid:\n- ${issues.join("\n- ")}`);

  return catalog;
}

async function loadSkills() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skillEntries = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !entry.name.endsWith("-workspace"),
  );
  const catalog = await loadCatalog(skillEntries.map((entry) => entry.name));
  const committedUpdatedAt = await loadCommittedUpdatedAt();
  const listItems = [];
  const detailItems = [];

  for (const entry of skillEntries) {
    const slug = entry.name;
    const skillRoot = path.join(skillsDir, slug);
    const skillFile = path.join(skillRoot, "SKILL.md");
    const raw = await fs.readFile(skillFile, "utf8");
    const frontmatter = parseFrontmatter(raw);
    const metadata =
      frontmatter.metadata && typeof frontmatter.metadata === "object"
        ? {
            ...(typeof frontmatter.metadata.author === "string"
              ? { author: frontmatter.metadata.author }
              : {}),
            ...(typeof frontmatter.metadata.version === "string"
              ? { version: frontmatter.metadata.version }
              : {}),
          }
        : undefined;

    const updatedAt = committedUpdatedAt?.get(slug) ?? readGitUpdatedAt(slug);

    const allowedToolsRaw = frontmatter["allowed-tools"];
    const allowedTools =
      typeof allowedToolsRaw === "string"
        ? allowedToolsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined;

    const sections = parseSections(raw);
    const showcasePath = path.join(skillRoot, "showcase.yaml");
    const showcase = (await exists(showcasePath))
      ? normalizeShowcase(
          YAML.parse(await fs.readFile(showcasePath, "utf8")),
          slug,
        )
      : undefined;
    const hasReferences = await exists(path.join(skillRoot, "references"));
    const hasSrc = await exists(path.join(skillRoot, "src"));
    const hasScripts = await exists(path.join(skillRoot, "scripts"));

    listItems.push({
      slug,
      name: frontmatter.name || slug,
      description: frontmatter.description || "",
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      files: {
        hasReferences,
        hasSrc,
        ...(hasScripts ? { hasScripts: true } : {}),
      },
      ...(updatedAt ? { updatedAt } : {}),
      ...(allowedTools?.length ? { allowedTools } : {}),
      catalog: catalog.skills[slug],
    });

    detailItems.push({
      slug,
      ...(sections.length > 0 ? { sections } : {}),
      ...(showcase ? { showcase } : {}),
    });
  }

  // Parse through the shared schema so the site never reads data it cannot type.
  return {
    layout: catalogLayoutSchema.parse({
      groups: catalog.groups,
      featured: catalog.featured,
    }),
    listItems: skillListSchema.parse(
      listItems.sort((a, b) => a.slug.localeCompare(b.slug)),
    ),
    detailItems: skillDetailListSchema.parse(
      detailItems.sort((a, b) => a.slug.localeCompare(b.slug)),
    ),
  };
}

async function main() {
  const { layout, listItems, detailItems } = await loadSkills();
  await fs.mkdir(path.dirname(listOutputPath), { recursive: true });
  await fs.writeFile(
    listOutputPath,
    `${JSON.stringify(listItems, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    detailOutputPath,
    `${JSON.stringify(detailItems, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    layoutOutputPath,
    `${JSON.stringify(layout, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Generated ${listItems.length} skills -> ${listOutputPath}, ${detailOutputPath}, ${layoutOutputPath}`,
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
