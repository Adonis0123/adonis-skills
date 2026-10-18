import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Stable anchor id for a heading. The detail page uses the same function for
 * heading ids and table-of-contents links, so they always agree.
 */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[`*_~[\]()]/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * Gives every heading a unique anchor; repeated headings get -2, -3 suffixes.
 * `reserved` are ids the page already uses (its own sections), so a SKILL.md heading
 * with the same text starts at -2 instead of colliding with them.
 */
export function withHeadingIds<T extends { heading?: string }>(
  sections: T[],
  reserved: string[] = [],
): (T & { id?: string })[] {
  const seen = new Map<string, number>(reserved.map((id) => [id, 1]));
  return sections.map((section) => {
    if (!section.heading) return section;
    const base = headingSlug(section.heading);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...section, id: count === 1 ? base : `${base}-${count}` };
  });
}

// Short inline code (skill names, flags) stays on one line instead of breaking at a hyphen;
// long paths may still wrap so they never push a narrow screen sideways.
const SHORT_INLINE_CODE = 28;

function isShortInlineCode(children: unknown): boolean {
  return typeof children === "string" && children.length <= SHORT_INLINE_CODE;
}

const components: Components = {
  p: ({ children }) => (
    <p className="text-sm leading-7 text-foreground md:text-[15px]">
      {children}
    </p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
      className="clay-focus-ring rounded-sm text-link underline underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-7 marker:text-muted-foreground md:text-[15px]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-7 marker:text-muted-foreground md:text-[15px]">
      {children}
    </ol>
  ),
  h1: ({ children }) => (
    <h4 className="mt-2 text-base font-bold">{children}</h4>
  ),
  h2: ({ children }) => (
    <h4 className="mt-2 text-base font-bold">{children}</h4>
  ),
  h3: ({ children }) => (
    <h4 className="mt-2 text-base font-bold">{children}</h4>
  ),
  h4: ({ children }) => <h4 className="mt-2 text-sm font-bold">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-input pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    // Wrap long lines instead of showing a scrollbar; tables keep horizontal scroll.
    <pre className="rounded-[12px] border border-border bg-background p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    className?.startsWith("language-") ? (
      <code className={className}>{children}</code>
    ) : (
      <code
        className={`rounded bg-muted px-[0.2em] py-0.5 font-mono text-[0.9em] text-foreground${
          isShortInlineCode(children) ? " whitespace-nowrap" : ""
        }`}
      >
        {children}
      </code>
    ),
  // Narrow screens scroll the table sideways instead of squeezing cells: inline code never wraps, and
  // cells keep a minimum width so short labels such as "L2 Fan-out" stay on one line.
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-sm [&_code]:whitespace-nowrap">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted text-foreground">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="min-w-32 border-b border-border px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="min-w-32 border-b border-border px-3 py-2 align-top">
      {children}
    </td>
  ),
  hr: () => <hr className="border-border" />,
};

/** Renders a SKILL.md section (CommonMark + GFM tables, task lists, strikethrough). */
export function renderSectionContent(raw: string) {
  return (
    <div className="space-y-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {raw}
      </ReactMarkdown>
    </div>
  );
}
