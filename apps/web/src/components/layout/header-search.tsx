"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLingui } from "@lingui/react/macro";
import { writeSearchParam } from "@/components/use-catalog-filters";
import { resolveLocaleValue } from "@/i18n/config";
import { withLocalePath } from "@/i18n/href";

/** Marks the page's own search input; the shortcut focuses it before the header field. */
export const PRIMARY_SEARCH_ATTR = "data-search-primary";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** Path without the locale prefix, e.g. `/zh/skills` -> `/skills`. */
export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/";
}

/**
 * Compact header search. `/` or ⌘K / Ctrl+K focuses the page's own search
 * box when it has one, otherwise this field. Enter opens /skills?q=… in the
 * current locale; on /skills itself it only updates the URL.
 */
export function HeaderSearch() {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSlash =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target);
      const isCmdK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isSlash && !isCmdK) return;
      const primary = document.querySelector<HTMLInputElement>(
        `[${PRIMARY_SEARCH_ATTR}]`,
      );
      const target = primary && isVisible(primary) ? primary : inputRef.current;
      if (!target || !isVisible(target)) return;
      event.preventDefault();
      target.focus();
      target.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = value.trim();
    if (stripLocale(pathname) === "/skills") writeSearchParam(q);
    else
      router.push(
        withLocalePath(
          q ? `/skills?q=${encodeURIComponent(q)}` : "/skills",
          locale,
        ),
      );
    setValue("");
    inputRef.current?.blur();
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="clay-focus-within-ring flex h-10 w-60 items-center gap-2 rounded-[10px] border border-border bg-card pr-2 pl-3 text-muted-foreground transition-colors focus-within:border-ring xl:w-64"
    >
      <span className="icon-[lucide--search] size-4 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={t({
          id: "siteHeader.search.aria",
          message: "Search skills",
        })}
        placeholder={t({
          id: "siteHeader.search.placeholder",
          message: "Search skills",
        })}
        className="min-w-0 flex-1 appearance-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="type-mono shrink-0 rounded-[5px] border border-border px-1.5 text-[11px] leading-[18px] text-muted-foreground">
        /
      </kbd>
    </form>
  );
}
