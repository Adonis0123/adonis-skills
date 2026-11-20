"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { useCopyToClipboard } from "@/components/copy-install-command";
import { playBeamLap } from "@/components/motion/beam-lap";
import { HoverFx } from "@/components/motion/hover-fx";
import { IconSwap } from "@/components/motion/press-scale";
import { useCopyTarget } from "@/components/motion/use-copy-target";
import { cx } from "@/components/ui/utils";

interface CommandBlockProps {
  /** One or more shell commands, run in order; copied together, newline-joined. */
  commands: string[];
  /** Accessible name for the copy button, e.g. "Copy the install command for commit". */
  label?: string;
  className?: string;
}

/** How long 「已复制」 stays on a copy box before 「点击复制」 returns (coco-skills uses ~1.2s). */
const COPIED_HINT_MS = 1200;

interface ScrollState {
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
}

/**
 * Terminal-style command box: `$` prompts, hidden-scrollbar horizontal scroll
 * with an edge fade, and a copy button. The whole box is the copy target
 * (useCopyTarget): a click anywhere copies unless text in it is selected;
 * the button stays for the keyboard. Hover shows the beam, the dots and
 * 「点击复制」 beside the icon; success runs one mustard lap (effects-hover.css)
 * and the hint turns 「已复制」 (effects-copy.css).
 */
export function CommandBlock({
  commands,
  label,
  className,
}: CommandBlockProps) {
  const { t } = useLingui();
  const { status, copied, failed, copy } = useCopyToClipboard(COPIED_HINT_MS);
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLElement>(null);

  const onCopy = async () => {
    if (await copy(commands.join("\n"))) {
      playBeamLap(boxRef.current);
      return;
    }
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
  const copyTarget = useCopyTarget(() => void onCopy());

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
      ref={boxRef}
      {...copyTarget}
      className={cx(
        "ink-box ink-box--md fx-surface fx-copy flex w-0 min-w-full items-start bg-background text-foreground",
        className,
      )}
    >
      <HoverFx />
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

      {/* 「点击复制」 on hover / keyboard focus, 「已复制」 after a copy (effects-copy.css). Its own slot beside
          the icon, so it never covers the command; touch has no hover, so phones skip the slot. */}
      <span
        aria-hidden
        data-copied={copied || undefined}
        className="copy-hint my-1.5 h-8 shrink-0 items-center text-xs whitespace-nowrap max-sm:hidden"
      >
        <span className="copy-hint-idle text-muted-foreground">
          {t({ id: "commandBlock.hint.copy", message: "Click to copy" })}
        </span>
        <span className="copy-hint-done font-medium text-link">
          {t({ id: "commandBlock.hint.copied", message: "Copied" })}
        </span>
      </span>
      <button
        type="button"
        data-copy-target
        onClick={() => void onCopy()}
        aria-label={
          label ?? t({ id: "commandBlock.copy.aria", message: "Copy command" })
        }
        className={cx(
          "clay-focus-ring relative m-1.5 ml-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-[background-color,color] duration-200 ease-out hover:bg-accent hover:text-foreground",
          // Expand the touch target to 44px without growing the visual button.
          'before:absolute before:-inset-1.5 before:content-[""]',
          copied && "text-foreground",
          failed && "text-danger-text hover:text-danger-text",
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

interface CopyTextBlockProps {
  /** The exact text that is shown and copied. */
  text: string;
  /** `command`: one shell line in mono. `prompt`: multi-line text for an agent. */
  kind?: "command" | "prompt";
  /** Accessible name for the whole-block button, e.g. "Copy the Claude Code install command". */
  label: string;
  className?: string;
}

/**
 * Shows text as-is (no `$` prompt, wrapped, never scrolled) and copies it when
 * any part of the block is clicked (useCopyTarget: not while text in it is
 * selected); the pill button turns into "Copied" and the beam runs one lap.
 */
// Longest token kept on one row; longer ones (a URL on a phone) may still break.
const MAX_UNBROKEN = 40;

/**
 * Lets a command wrap only between words, so `--marketplace` or
 * `delete-guard@nika` never splits at a hyphen. Only spans are added: the DOM
 * text, and so a manual selection, stays exactly `text`.
 */
function UnbrokenWords({ text }: { text: string }) {
  return text.split(/( +|\n)/).map((part, index) =>
    part.trim() && part.length <= MAX_UNBROKEN ? (
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function CopyTextBlock({
  text,
  kind = "command",
  label,
  className,
}: CopyTextBlockProps) {
  const { t } = useLingui();
  const { status, copied, failed, copy } = useCopyToClipboard(COPIED_HINT_MS);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLElement>(null);

  const onCopy = async () => {
    if (await copy(text)) {
      playBeamLap(boxRef.current);
      return;
    }
    // Both clipboard paths failed: select the text so a manual Ctrl/Cmd+C still works.
    const node = textRef.current;
    const selection = window.getSelection();
    if (node && selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };
  const copyTarget = useCopyTarget(() => void onCopy());

  const idleLabel =
    kind === "prompt"
      ? t({ id: "copyBlock.label.copyPrompt", message: "Copy prompt" })
      : t({ id: "copyBlock.label.copy", message: "Copy" });

  return (
    // The whole box is the copy target (useCopyTarget), so text stays selectable; the pill is
    // its keyboard button (`data-copy-target`) and shows the state.
    <div
      ref={boxRef}
      {...copyTarget}
      className={cx(
        "group ink-box ink-box--md fx-surface fx-copy relative bg-background text-foreground transition-colors duration-200",
        failed && "[--ink-line:var(--danger-text)]",
        className,
      )}
    >
      <HoverFx />
      <pre
        className={cx(
          "m-0 py-3 pr-28 pl-3.5 whitespace-pre-wrap [overflow-wrap:anywhere]",
          kind === "prompt"
            ? "font-sans text-[13.5px] leading-[1.7]"
            : "font-mono text-[13px] leading-6",
        )}
      >
        <code ref={textRef} className="font-[inherit]">
          {kind === "command" ? <UnbrokenWords text={text} /> : text}
        </code>
      </pre>
      <button
        type="button"
        data-copy-target
        onClick={() => void onCopy()}
        aria-label={label}
        className={cx(
          "clay-focus-ring ink-box ink-box--pill absolute top-2 right-2 inline-flex h-7 items-center gap-1.5 bg-card px-2.5 text-[12.5px] font-medium transition-colors duration-200",
          // Expand the touch target without growing the pill (its ::before draws the ink line).
          'after:absolute after:-inset-2 after:content-[""]',
          copied
            ? "text-link"
            : failed
              ? "text-danger-text [--ink-line:var(--danger-text)]"
              : "text-foreground group-hover:text-link group-hover:[--ink-line:var(--primary)]",
        )}
      >
        <IconSwap swapKey={status} className="size-3.5">
          <span
            aria-hidden
            className={cx(
              {
                idle: "icon-[lucide--copy]",
                copied: "icon-[lucide--check]",
                failed: "icon-[lucide--circle-alert]",
              }[status],
              "size-3.5",
            )}
          />
        </IconSwap>
        <span aria-hidden>
          {copied
            ? t({ id: "copyBlock.label.copied", message: "Copied" })
            : failed
              ? t({ id: "copyBlock.label.failed", message: "Copy failed" })
              : idleLabel}
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied && t({ id: "copyBlock.live.copied", message: "Copied" })}
        {failed &&
          t({
            id: "copyBlock.live.failed",
            message: "Copy failed. The text is selected; copy it manually.",
          })}
      </span>
    </div>
  );
}
