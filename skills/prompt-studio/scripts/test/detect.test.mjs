import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSource } from "../adapters/detect.mjs";

function fetcher(files) {
  const seen = [];
  const fetchText = async (filePath) => {
    seen.push(filePath);
    if (!(filePath in files)) throw new Error(`missing ${filePath}`);
    return files[filePath];
  };
  return { fetchText, seen };
}

const VIDEO_CASES = JSON.stringify({
  cases: [
    {
      slug: "diner-frozen-time",
      title: "Frozen diner",
      summary: "A rewind",
      promptFull: "Lock the diner spill at its peak and rewind every droplet.",
      mediaType: "video",
      mediaUrl: "https://media.example/diner.mp4",
      posterUrl: "https://media.example/diner.jpg",
      models: ["Seedance 2.5"],
      creator: "@techhalla",
      sourceUrl: "https://x.com/techhalla/status/2083389002552664385",
      category: "video",
      tags: ["rewind"],
    },
    {
      slug: "second",
      title: "Second",
      promptFull: "Another full prompt for a night drive through rain.",
      mediaType: "video",
      mediaUrl: "https://media.example/second.mp4",
      posterUrl: "https://media.example/second.jpg",
      creator: "@a",
      sourceUrl: "https://x.com/a/status/2",
    },
    {
      slug: "third",
      title: "Third",
      promptFull: "A third prompt long enough to count as a real entry.",
      mediaType: "video",
      mediaUrl: "https://media.example/third.mp4",
      posterUrl: "https://media.example/third.jpg",
    },
  ],
});

const README_BLOCKS = `### One

**Prompt:**
\`\`\`
first prompt text for the readme detector
\`\`\`

### Two

\`\`\`
second prompt text for the readme detector
\`\`\`

### Three

**Prompt:**
plain text after the label is still a prompt block
`;

describe("detectSource", () => {
  it("prefers a data/ JSON array and guesses a json-map", async () => {
    const { fetchText, seen } = fetcher({
      "data/cases.json": VIDEO_CASES,
      "README.md": README_BLOCKS,
      "package.json": JSON.stringify([
        { prompt: "do not use the package file" },
      ]),
      "prompts/image/a.yaml": "prompt: |\n  hello from yaml\n",
    });
    const found = await detectSource({
      repo: "LearnPrompt/awesome-seedance",
      branch: "main",
      tree: {
        tree: [
          { path: "data/cases.json", type: "blob" },
          { path: "README.md", type: "blob" },
          { path: "package.json", type: "blob" },
          { path: "prompts/image/a.yaml", type: "blob" },
        ],
      },
      fetchText,
    });
    assert.equal(found.adapter, "json-map");
    assert.equal(found.confidence, "high");
    assert.deepEqual(found.kinds, ["video"]);
    assert.equal(found.options.file, "data/cases.json");
    assert.equal(found.options.itemsPath, "cases");
    assert.equal(found.options.map.nativeId, "slug");
    assert.equal(found.options.map.content, "promptFull");
    assert.equal(found.options.map.sourceMedia, "posterUrl");
    assert.equal(found.options.map.videos, "mediaUrl");
    assert.equal(found.options.map.model, "models");
    assert.equal(found.options.map.author, "creator");
    assert.equal(found.options.map.link, "sourceUrl");
    assert.equal(found.options.map.title, "title");
    assert.deepEqual(seen, ["data/cases.json"]);
  });

  it("maps a root JSON array and a nested prompts array", async () => {
    const root = await detectSource({
      repo: "example/root-prompts",
      branch: "main",
      tree: [{ path: "prompts.json", type: "blob" }],
      fetchText: async () =>
        JSON.stringify([
          {
            id: 1,
            title: "Cat",
            prompt: "a small cat on a windowsill in warm light",
            image: "/images/1.jpg",
            author: "Ada",
            url: "https://example.com/1",
          },
          {
            id: 2,
            title: "Dog",
            prompt: "a dog running through shallow water at dusk",
            preview: "https://cdn.example/2.jpg",
          },
          {
            id: 3,
            title: "Bird",
            prompt: "a bird made of paper against a blue sky",
            thumbnail: "https://cdn.example/3.jpg",
          },
        ]),
    });
    assert.equal(root.adapter, "json-map");
    assert.equal(root.options.itemsPath, "");
    assert.equal(root.options.map.nativeId, "id");
    assert.equal(root.options.map.content, "prompt");
    assert.equal(root.options.map.sourceMedia, "image");
    assert.equal(root.options.map.author, "author");
    assert.equal(root.options.map.link, "url");
    assert.deepEqual(root.kinds, ["image"]);

    const nested = await detectSource({
      repo: "example/grouped",
      branch: "main",
      tree: [{ path: "data/grouped.json", type: "blob" }],
      fetchText: async () =>
        JSON.stringify({
          sections: [
            {
              prompts: [
                { title: "A", prompt: "alpha prompt text long enough" },
                { title: "B", prompt: "beta prompt text long enough" },
                { title: "C", prompt: "gamma prompt text long enough" },
              ],
            },
          ],
        }),
    });
    assert.equal(nested.options.file, "data/grouped.json");
    assert.equal(nested.options.itemsPath, "sections[].prompts");
    assert.equal(nested.options.map.content, "prompt");
  });

  it("falls through a prompt-less JSON file to per-entry YAML", async () => {
    const files = {
      "data/notes.json": JSON.stringify({ note: "not a prompt list" }),
      "prompts/image/a.yaml":
        "id: a\ntitle:\n  en: Festival\n  zh: 音乐节\nprompt: |\n  A crowd in 1969.\n",
      "prompts/image/b.yaml": "id: b\nprompt: |\n  A second image prompt.\n",
      "prompts/video/c.yaml": "id: c\nprompt: |\n  A tracking shot at night.\n",
      "previews/a.jpg": "",
    };
    const { fetchText, seen } = fetcher(files);
    const found = await detectSource({
      repo: "ai-boost/awesome-image-video-prompts",
      branch: "main",
      tree: Object.keys(files).map((filePath) => ({
        path: filePath,
        type: "blob",
      })),
      fetchText,
    });
    assert.equal(found.adapter, "yaml-tree");
    assert.deepEqual(found.options.include, [
      "prompts/image/*.yaml",
      "prompts/video/*.yaml",
    ]);
    assert.equal(found.options.previewBase, "previews/");
    assert.equal(found.options.locale, "en");
    assert.deepEqual(found.kinds, ["image", "video"]);
    assert.equal(found.confidence, "high");
    assert.equal(seen.includes("prompts/image/a.yaml"), true);
    assert.equal(seen.includes("prompts/video/c.yaml"), true);
    assert.equal(seen.includes("prompts/image/b.yaml"), true);
  });

  it("uses README sections, or the markdown directory with more prompt blocks", async () => {
    const readme = await detectSource({
      repo: "ZeroLu/awesome-nanobanana-pro",
      branch: "main",
      tree: [
        { path: "README.md", type: "blob" },
        { path: ".github/workflows/update.yml", type: "blob" },
      ],
      fetchText: async (filePath) =>
        filePath === "README.md" ? README_BLOCKS : "name: update",
    });
    assert.equal(readme.adapter, "markdown");
    assert.deepEqual(readme.options, {
      files: ["README.md"],
      mode: "sections",
    });
    assert.deepEqual(readme.kinds, ["image"]);
    assert.equal(readme.confidence, "high");
    assert.match(readme.reason, /README.md has 3/);

    const block = (title) =>
      `### ${title}\n\n\`\`\`\n${title} prompt text that is long enough to keep\n\`\`\`\n`;
    const grouped = await detectSource({
      repo: "Evolink-AI/awesome-gpt-image-2-API-Prompts",
      branch: "main",
      tree: [
        { path: "README.md", type: "blob" },
        { path: "cases/a.md", type: "blob" },
        { path: "cases/b.md", type: "blob" },
      ],
      fetchText: async (filePath) => {
        if (filePath === "README.md") return block("Only");
        if (filePath === "cases/a.md") return block("A1") + block("A2");
        return block("B1") + block("B2");
      },
    });
    assert.equal(grouped.adapter, "markdown");
    assert.equal(grouped.options.glob, "cases/*.md");
    assert.equal(grouped.options.mode, "sections");
    assert.match(grouped.reason, /cases\/\*\.md/);

    const empty = await detectSource({
      repo: "example/empty",
      branch: "dev",
      tree: [],
      fetchText: async () => "",
    });
    assert.equal(empty.adapter, null);
    assert.equal(empty.confidence, "low");
    assert.match(empty.reason, /dev/);
  });

  it("does not treat install, build, and usage fences as a prompt library", async () => {
    const readme = `## Install

\`\`\`bash
npm install
\`\`\`

## Build

\`\`\`bash
npm run build
\`\`\`

## Usage

\`\`\`bash
node app.js
\`\`\`
`;
    const found = await detectSource({
      repo: "example/tool",
      branch: "main",
      tree: [{ path: "README.md", type: "blob" }],
      fetchText: async () => readme,
    });
    assert.equal(found.adapter, null);
    assert.equal(found.confidence, "low");
    assert.deepEqual(found.options, {});
  });

  it("returns no adapter when the README has no prompt", async () => {
    const found = await detectSource({
      repo: "example/plain",
      branch: "main",
      tree: [{ path: "README.md", type: "blob" }],
      fetchText: async () =>
        "# Plain\n\nA project description without prompts.\n",
    });
    assert.equal(found.adapter, null);
    assert.equal(found.confidence, "low");
    assert.match(found.reason, /No prompt evidence/);
    assert.deepEqual(found.options, {});
  });

  it("keeps the truncated marker on a JSON guess", async () => {
    const found = await detectSource({
      repo: "LearnPrompt/awesome-seedance",
      branch: "main",
      tree: {
        truncated: true,
        tree: [{ path: "data/cases.json", type: "blob" }],
      },
      fetchText: async () => VIDEO_CASES,
    });
    assert.equal(found.adapter, "json-map");
    assert.match(found.reason, /truncated/);
  });

  it("samples later YAML files and counts hits, not the directory size", async () => {
    const files = {
      "prompts/image/a.yaml": "title: notes\nbody: not a prompt\n",
      "prompts/image/b.yaml":
        "prompt: |\n  A real image prompt with enough detail.\n",
      "prompts/image/c.yaml": "title: also notes\n",
    };
    for (let i = 0; i < 6; i++) {
      files[`prompts/wide/p${i}.yaml`] =
        i === 0
          ? "prompt: |\n  Only the first file is a prompt.\n"
          : "name: empty\n";
    }
    const { fetchText, seen } = fetcher(files);
    const found = await detectSource({
      repo: "example/yaml-sample",
      branch: "main",
      tree: Object.keys(files).map((filePath) => ({
        path: filePath,
        type: "blob",
      })),
      fetchText,
    });
    assert.equal(found.adapter, "yaml-tree");
    assert.equal(seen.includes("prompts/image/a.yaml"), true);
    assert.equal(seen.includes("prompts/image/b.yaml"), true);
    assert.deepEqual(found.options.include, [
      "prompts/image/*.yaml",
      "prompts/wide/*.yaml",
    ]);
    assert.equal(found.confidence, "medium");
    assert.match(found.reason, /\b2\b/);
    assert.doesNotMatch(found.reason, /\b6\b/);
  });

  it("keeps both yaml and yml globs when both extensions have hits", async () => {
    const files = {
      "prompts/mixed/a.yaml":
        "prompt: |\n  A yaml prompt with enough detail here.\n",
      "prompts/mixed/b.yml":
        "prompt: |\n  A yml prompt with enough detail here.\n",
    };
    const { fetchText } = fetcher(files);
    const found = await detectSource({
      repo: "example/mixed-yaml",
      branch: "main",
      tree: Object.keys(files).map((filePath) => ({
        path: filePath,
        type: "blob",
      })),
      fetchText,
    });
    assert.equal(found.adapter, "yaml-tree");
    assert.deepEqual(found.options.include, [
      "prompts/mixed/*.yaml",
      "prompts/mixed/*.yml",
    ]);
    assert.equal(found.confidence, "medium");
  });
});
