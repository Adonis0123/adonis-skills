"use client";

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLingui } from "@lingui/react/macro";
import { IconSwap } from "@/components/motion/press-scale";
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
  /** `solid`: leaf primary fill (featured cards). `outline`: quiet card button. */
  variant?: "solid" | "outline";
  /** Hide the visible label below the `sm` breakpoint; the aria-label still names the action. */
  iconOnlyOnMobile?: boolean;
  preventLinkNavigation?: boolean;
  /** Accessible name, e.g. "Copy install command for Commit Writer". */
  label?: string;
  className?: string;
}

/** Copy button with a short visible label ("Copy" / "Copied") and a live announcement. */
export function CopyInstallCommandButton({
  command,
  variant = "solid",
  iconOnlyOnMobile = false,
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

  const iconClass = {
    idle: "icon-[lucide--copy]",
    copied: "icon-[lucide--check]",
    failed: "icon-[lucide--circle-alert]",
  }[status];

  // All three labels share one grid cell so the button keeps the widest label's width.
  const labelClass = (visible: boolean) =>
    cx(
      "col-start-1 row-start-1 transition-opacity duration-150",
      visible ? "opacity-100" : "opacity-0",
    );

  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        aria-label={
          label ?? t({ id: "copyCommand.aria.copy", message: "Copy command" })
        }
        className={cx(
          "copy-button clay-focus-ring",
          variant === "solid" ? "copy-button--solid" : "copy-button--outline",
          failed && "copy-button--failed",
          className,
        )}
      >
        {/* Copy -> check pops in place; the box keeps its size so the label never shifts. */}
        <IconSwap swapKey={status} className="size-3.5 shrink-0">
          <span className={cx(iconClass, "size-3.5")} />
        </IconSwap>
        <span
          className={cx(
            "grid justify-items-start",
            iconOnlyOnMobile && "max-sm:hidden",
          )}
          aria-hidden
        >
          <span className={labelClass(status === "idle")}>
            {t({ id: "copyCommand.label.copy", message: "Copy" })}
          </span>
          <span className={labelClass(copied)}>
            {t({ id: "copyCommand.label.copied", message: "Copied" })}
          </span>
          <span className={labelClass(failed)}>
            {t({ id: "copyCommand.label.failed", message: "Failed" })}
          </span>
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied && t({ id: "copyCommand.live.copied", message: "Copied" })}
        {failed &&
          t({
            id: "copyCommand.live.failed",
            message: "Copy failed. Select the command and copy it manually.",
          })}
      </span>
    </>
  );
}
