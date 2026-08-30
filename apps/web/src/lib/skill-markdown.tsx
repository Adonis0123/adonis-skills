import * as React from "react";

interface Block {
  type: "paragraph" | "code" | "list" | "heading" | "table";
  content?: string;
  lang?: string;
  level?: number;
  items?: string[];
}

function renderInlineMarkdown(content: string): React.ReactNode {
  return content
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={index}>{part.slice(2, -2)}</strong>;

      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={index}
            className="rounded bg-background/70 px-1 py-0.5 text-[0.9em] text-foreground"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      return <React.Fragment key={index}>{part}</React.Fragment>;
    });
}

function parseTable(
  content: string,
): { headers: string[]; rows: string[][] } | null {
  const rows = content.split("\n").map((line) =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim()),
  );

  if (rows.length < 2 || !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell)))
    return null;

  const headers = rows[0];
  const width = headers.length;
  return {
    headers,
    rows: rows.slice(2).filter((row) => row.length === width),
  };
}

function parseBlocks(raw: string): Block[] {
  const lines = raw.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", content: codeLines.join("\n"), lang });
      continue;
    }

    // Heading (### level)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        content: headingMatch[2],
        level: headingMatch[1].length,
      });
      i++;
      continue;
    }

    // Bullet list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (
        i < lines.length &&
        (lines[i].startsWith("- ") || lines[i].startsWith("* "))
      ) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Table (pipe-delimited)
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", content: tableLines.join("\n") });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect until blank line or special block start
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith("- ") &&
      !lines[i].startsWith("* ") &&
      !lines[i].startsWith("|")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", content: paraLines.join(" ") });
    }
  }

  return blocks;
}

export function renderSectionContent(raw: string): React.ReactNode {
  const blocks = parseBlocks(raw);

  return blocks.map((block, idx) => {
    switch (block.type) {
      case "paragraph":
        return (
          <p key={idx} className="text-sm leading-7 text-clay-muted">
            {renderInlineMarkdown(block.content ?? "")}
          </p>
        );
      case "code":
        return (
          <pre
            key={idx}
            className="overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6"
          >
            <code>{block.content}</code>
          </pre>
        );
      case "list":
        return (
          <ul
            key={idx}
            className="list-disc list-inside space-y-1 text-sm leading-7 text-clay-muted"
          >
            {block.items?.map((item, i) => (
              <li key={i}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>
        );
      case "heading":
        return (
          <h4
            key={idx}
            className="mb-1 mt-2 text-sm font-semibold text-foreground"
          >
            {renderInlineMarkdown(block.content ?? "")}
          </h4>
        );
      case "table": {
        const table = parseTable(block.content ?? "");
        if (!table) {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6"
            >
              <code>{block.content}</code>
            </pre>
          );
        }

        return (
          <div
            key={idx}
            className="overflow-x-auto rounded-xl border border-border/60 bg-background/55"
          >
            <table className="w-full min-w-[32rem] border-collapse text-left text-xs leading-5">
              <thead className="bg-[#87a6dd]/10 text-foreground">
                <tr>
                  {table.headers.map((header, headerIndex) => (
                    <th
                      key={`${header}-${headerIndex}`}
                      className="border-b border-border/60 px-3 py-2 font-semibold"
                    >
                      {renderInlineMarkdown(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b border-border/40 last:border-b-0"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-3 py-2 align-top text-clay-muted"
                      >
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return null;
    }
  });
}
