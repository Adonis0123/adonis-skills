"use client";

import {
  useEffect,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type Ref,
} from "react";
import {
  getSamePageHash,
  scrollToHash,
  type HistoryMode,
} from "@/lib/smooth-scroll";

interface SmoothScrollOptions {
  /** Pixels to keep above the target; defaults to the sticky header offset. */
  offset?: number;
  /** "push" (default) | "replace" | false (leave the URL alone). */
  history?: HistoryMode;
  /** Focus the target after scrolling. Default true. */
  focus?: boolean;
}

/**
 * Mount once (e.g. in the locale layout). Intercepts plain left-clicks on
 * same-page hash links anywhere in the document, including next/link,
 * and smooth-scrolls instead of jumping.
 *
 * Runs in the window capture phase so it acts before React / Next.js Link
 * handlers; Link skips its own navigation once `defaultPrevented` is set.
 * Opt a link out with `data-no-smooth-scroll`.
 */
export function SmoothScrollProvider({
  offset,
  history = "push",
  focus = true,
}: SmoothScrollOptions) {
  useEffect(() => {
    const onClick = (event: globalThis.MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const hash = getSamePageHash(anchor, event, window.location);
      if (!hash) return;
      const id = hash.slice(1);
      if (id && id !== "top" && !document.getElementById(safeDecode(id)))
        return;
      event.preventDefault();
      void scrollToHash(hash, { offset, history, focus });
    };

    window.addEventListener("click", onClick, { capture: true });
    return () =>
      window.removeEventListener("click", onClick, { capture: true });
  }, [offset, history, focus]);

  return null;
}

type SmoothAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  SmoothScrollOptions & {
    /** Same-page hash, e.g. "#skills". */
    href: `#${string}`;
    ref?: Ref<HTMLAnchorElement>;
  };

/**
 * A plain <a href="#id"> that smooth-scrolls on click. Works without the
 * provider; with the provider mounted, the provider handles the click first.
 * Without JS it is still a working native anchor.
 */
export function SmoothAnchor({
  href,
  offset,
  history = "push",
  focus = true,
  onClick,
  ref,
  ...rest
}: SmoothAnchorProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const hash = getSamePageHash(event.currentTarget, event, window.location);
    if (!hash) return;
    event.preventDefault();
    void scrollToHash(hash, { offset, history, focus });
  };

  return <a ref={ref} href={href} onClick={handleClick} {...rest} />;
}

function safeDecode(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
