"use client";

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLingui } from "@lingui/react/macro";
import { ClayButton } from "@/components/ui";
import { cx } from "@/components/ui/utils";

const COPIED_RESET_MS = 2000;

export interface ClipboardDeps {
  /** Async Clipboard API; missing on insecure origins and some embedded browsers. */
  writeText?: (text: string) => Promise<void>;
  /** Legacy fallback; returns true only when the browser reports a successful copy. */
  execCopy?: (text: string) => boolean;
}

function execCommandCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function browserClipboardDeps(): ClipboardDeps {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return {
    writeText: clipboard?.writeText
      ? (text) => clipboard.writeText(text)
      : undefined,
    execCopy: execCommandCopy,
  };
}

/** Copies text, falling back to execCommand; resolves true only on a confirmed copy. */
export async function copyTextToClipboard(
  text: string,
  deps: ClipboardDeps = browserClipboardDeps(),
): Promise<boolean> {
  if (deps.writeText) {
    try {
      await deps.writeText(text);
      return true;
    } catch {
      // Permission denied or unsupported context: try the legacy path below.
    }
  }
  try {
    return deps.execCopy?.(text) ?? false;
  } catch {
    return false;
  }
}

export type CopyStatus = "idle" | "copied" | "failed";

/** Clipboard copy with a transient `copied` / `failed` status that resets after 2s. */
export function useCopyToClipboard(resetMs = COPIED_RESET_MS) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyTextToClipboard(text);
      window.clearTimeout(timerRef.current);
      setStatus(ok ? "copied" : "failed");
      timerRef.current = window.setTimeout(() => setStatus("idle"), resetMs);
      return ok;
    },
    [resetMs],
  );

  return {
    status,
    copied: status === "copied",
    failed: status === "failed",
    copy,
  };
}

interface CopyInstallCommandButtonProps {
  command: string;
  compact?: boolean;
  preventLinkNavigation?: boolean;
  // Accessible name for the compact icon button; defaults to a generic label.
  label?: string;
  className?: string;
}

export function CopyInstallCommandButton({
  command,
  compact = false,
  preventLinkNavigation = false,
  label,
  className,
}: CopyInstallCommandButtonProps) {
  const { t } = useLingui();
  const { status, copied, failed, copy } = useCopyToClipboard();

  const onCopy = (event: MouseEvent<HTMLButtonElement>) => {
    if (preventLinkNavigation) {
      event.preventDefault();
      event.stopPropagation();
    }
    void copy(command);
  };

  const announcement = (
    <span className="sr-only" aria-live="polite">
      {copied && t({ id: "copyCommand.live.copied", message: "Copied" })}
      {failed &&
        t({
          id: "copyCommand.live.failed",
          message: "Copy failed. Select the command and copy it manually.",
        })}
    </span>
  );

  const iconClass = {
    idle: "icon-[lucide--copy]",
    copied: "icon-[lucide--check]",
    failed: "icon-[lucide--circle-alert]",
  }[status];

  if (compact) {
    return (
      <>
        <ClayButton
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCopy}
          className={cx(
            "relative h-8 w-8 min-h-8 rounded-lg border border-border bg-background p-0 text-clay-muted shadow-none transition-[background-color,color,border-color] duration-250 ease-out hover:bg-accent hover:text-accent-foreground active:translate-y-0",
            // Keep the 32px visual size but give touch a 44px hit area.
            'after:absolute after:-inset-2 after:content-[""]',
            copied && "border-attribution bg-accent text-accent-foreground",
            failed &&
              "border-destructive text-destructive hover:text-destructive",
            className,
          )}
          aria-label={
            label ?? t({ id: "copyCommand.aria.copy", message: "Copy command" })
          }
        >
          <span
            className={cx(
              iconClass,
              "size-3.5 transition-transform duration-200 ease-out",
              copied && "scale-105",
            )}
            aria-hidden
          />
        </ClayButton>
        {announcement}
      </>
    );
  }

  // All three labels share one grid cell so the button keeps the widest label's width.
  const labelClass = (visible: boolean) =>
    cx(
      "col-start-1 row-start-1 transition-opacity duration-150",
      visible ? "opacity-100" : "opacity-0",
    );

  return (
    <>
      <ClayButton
        type="button"
        variant="primary"
        size="sm"
        onClick={onCopy}
        className={cx("font-mono", className)}
      >
        <span className={cx(iconClass, "size-3.5")} aria-hidden />
        <span className="grid justify-items-start">
          <span
            className={labelClass(status === "idle")}
            aria-hidden={status !== "idle"}
          >
            {t({ id: "copyCommand.button.copy", message: "Copy command" })}
          </span>
          <span className={labelClass(copied)} aria-hidden={!copied}>
            {t({ id: "copyCommand.button.copied", message: "Copied" })}
          </span>
          <span className={labelClass(failed)} aria-hidden={!failed}>
            {t({ id: "copyCommand.button.failed", message: "Copy failed" })}
          </span>
        </span>
      </ClayButton>
      {announcement}
    </>
  );
}
