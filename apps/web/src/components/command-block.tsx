"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { useCopyToClipboard } from "@/components/copy-install-command";
import { IconSwap } from "@/components/motion/press-scale";
import { cx } from "@/components/ui/utils";

interface CommandBlockProps {
  /** One or more shell commands, run in order; copied together, newline-joined. */
  commands: string[];
  /** Accessible name for the copy button, e.g. "Copy the install command for commit". */
  label?: string;
  className?: string;
}

interface ScrollState {
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

/** Terminal-style command box: `$` prompts, hidden-scrollbar horizontal scroll with an edge fade, and a copy button. */
export function CommandBlock({
  commands,
  label,
  className,
}: CommandBlockProps) {
  const { t } = useLingui();
  const { status, copied, failed, copy } = useCopyToClipboard();
  const scrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLElement>(null);

  const onCopy = async () => {
    if (await copy(commands.join("\n"))) return;
    // Both clipboard paths failed: select the text so a manual Ctrl/Cmd+C still works.
    const code = codeRef.current;
    const selection =
      typeof window === "undefined" ? null : window.getSelection();
    if (code && selection) {
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };
  const [scroll, setScroll] = useState<ScrollState>({
    overflowing: false,
    atStart: true,
    atEnd: true,
  });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflowing = el.scrollWidth - el.clientWidth > 1;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setScroll((prev) =>
      prev.overflowing === overflowing &&
      prev.atStart === atStart &&
      prev.atEnd === atEnd
        ? prev
        : { overflowing, atStart, atEnd },
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, commands]);

  const fadeClass =
    "pointer-events-none absolute inset-y-0 w-10 from-background to-transparent transition-opacity duration-200 motion-reduce:transition-none";

  return (
    // `w-0 min-w-full` keeps long commands from widening ancestors via min-content; the inner box scrolls instead.
    // The copy button sits in its own column outside the scroll area, so text never runs under it.
    <div
      className={cx(
        "flex w-0 min-w-full items-start rounded-[12px] border border-border bg-background text-foreground",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={measure}
          tabIndex={scroll.overflowing ? 0 : undefined}
          role={scroll.overflowing ? "region" : undefined}
          aria-label={
            scroll.overflowing
              ? t({
                  id: "commandBlock.scroll.aria",
                  message: "Command, scroll horizontally to see all",
                })
              : undefined
          }
          className="clay-focus-ring overflow-x-auto rounded-l-[12px] py-2.5 pr-2 pl-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <pre className="m-0 w-max min-w-full font-mono text-[13px] leading-6">
            <code ref={codeRef}>
              {commands.map((command, index) => (
                // Commands can repeat in theory; index keeps keys unique and order is fixed.
                <span key={index} className="block whitespace-pre">
                  <span aria-hidden className="mr-2 select-none text-link">
                    $
                  </span>
                  {command}
                </span>
              ))}
            </code>
          </pre>
        </div>

        <div
          aria-hidden
          className={cx(
            fadeClass,
            "left-0 rounded-l-[12px] bg-linear-to-r",
            scroll.atStart ? "opacity-0" : "opacity-100",
          )}
        />
        <div
          aria-hidden
          className={cx(
            fadeClass,
            "right-0 bg-linear-to-l",
            scroll.overflowing && !scroll.atEnd ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={
          label ?? t({ id: "commandBlock.copy.aria", message: "Copy command" })
        }
        className={cx(
          "clay-focus-ring relative m-1.5 ml-0 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-[background-color,color] duration-200 ease-out hover:bg-accent hover:text-foreground",
          // Expand the touch target to 44px without growing the visual button.
          'before:absolute before:-inset-1.5 before:content-[""]',
          copied && "text-foreground",
          failed && "text-destructive hover:text-destructive",
        )}
      >
        <IconSwap swapKey={status} className="size-4">
          <span
            className={cx(
              {
                idle: "icon-[lucide--copy]",
                copied: "icon-[lucide--check]",
                failed: "icon-[lucide--circle-alert]",
              }[status],
              "size-4",
            )}
          />
        </IconSwap>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied && t({ id: "commandBlock.live.copied", message: "Copied" })}
        {failed &&
          t({
            id: "commandBlock.live.failed",
            message: "Copy failed. The command is selected; copy it manually.",
          })}
      </span>
    </div>
  );
}
