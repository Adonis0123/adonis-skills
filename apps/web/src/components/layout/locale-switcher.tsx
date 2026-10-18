"use client";

import { useRef, useTransition } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useLingui } from "@lingui/react/macro";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import { cx } from "@/components/ui/utils";
import {
  type AppLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  resolveLocaleValue,
} from "@/i18n/config";
import { replaceLocalePath } from "@/i18n/href";

interface LocaleSwitcherProps {
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  contentAlign?: "start" | "center" | "end";
}

const localeLabelMap: Partial<Record<AppLocale, string>> = {
  en: "English",
  zh: "简体中文",
};

function getLocaleLabel(locale: AppLocale): string {
  return localeLabelMap[locale] ?? locale.toUpperCase();
}

/** Target URL for switching locale: swaps the path prefix, keeps query and hash. */
export function buildLocaleSwitchHref(
  pathname: string,
  search: string,
  hash: string,
  locale: AppLocale,
): string {
  const basePath = replaceLocalePath(pathname || "/", locale);
  const queryString = search.startsWith("?") ? search.slice(1) : search;
  return `${basePath}${queryString ? `?${queryString}` : ""}${hash}`;
}

/** Cookie the proxy reads so an unprefixed URL stops redirecting by Accept-Language. */
export function buildLocaleCookie(locale: AppLocale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function LocaleSwitcher({
  className,
  triggerClassName,
  contentClassName,
  contentAlign = "end",
}: LocaleSwitcherProps) {
  const { t } = useLingui();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Last input inside the open menu; decides whether focus returns visibly on close.
  const closedByPointerRef = useRef(false);
  const currentLocale = resolveLocaleValue(
    params?.lang as string | string[] | undefined,
  );
  const currentLabel = getLocaleLabel(currentLocale);

  const onValueChange = (nextLocaleValue: string) => {
    const nextLocale = resolveLocaleValue(nextLocaleValue);
    if (nextLocale === currentLocale) {
      return;
    }

    const search = typeof window === "undefined" ? "" : window.location.search;
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    const targetHref = buildLocaleSwitchHref(
      pathname || "/",
      search,
      hash,
      nextLocale,
    );
    // Write before navigating, or the proxy would bounce `/` back to /zh for Chinese browsers.
    document.cookie = buildLocaleCookie(nextLocale);

    startTransition(() => {
      router.replace(targetHref);
    });
  };

  const onCloseAutoFocus = (event: Event) => {
    if (!closedByPointerRef.current) {
      return;
    }
    // Mouse/touch close: return focus without the keyboard focus ring.
    event.preventDefault();
    triggerRef.current?.focus({
      preventScroll: true,
      focusVisible: false,
    } as FocusOptions);
  };

  return (
    <div className={cx("relative inline-flex items-center", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={isPending}>
          <button
            ref={triggerRef}
            type="button"
            aria-label={t({
              id: "localeSwitcher.trigger.aria",
              message: `Switch language (current: ${currentLabel})`,
            })}
            onPointerDown={() => {
              closedByPointerRef.current = true;
            }}
            onKeyDown={() => {
              closedByPointerRef.current = false;
            }}
            className={cx(
              "clay-focus-ring clay-button clay-button--secondary clay-button--sm group min-w-[132px] justify-between gap-2 rounded-full px-3 text-left text-xs md:text-sm",
              "data-[state=open]:border-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
              "disabled:cursor-not-allowed disabled:opacity-70",
              triggerClassName,
            )}
          >
            <span
              className={cx(
                "pointer-events-none icon-[lucide--globe] size-3.5 shrink-0 text-current opacity-70 transition-opacity duration-200",
                "group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100",
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
            <span
              className={cx(
                "pointer-events-none icon-[lucide--chevron-down] size-3.5 shrink-0 text-clay-muted transition-[rotate,color] duration-200 motion-reduce:transition-none",
                "group-hover:text-foreground group-focus-visible:text-foreground",
                "group-data-[state=open]:rotate-180 group-data-[state=open]:text-foreground",
              )}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={contentAlign}
          onCloseAutoFocus={onCloseAutoFocus}
          onPointerDownOutside={() => {
            closedByPointerRef.current = true;
          }}
          onPointerMove={() => {
            closedByPointerRef.current = true;
          }}
          onKeyDown={() => {
            closedByPointerRef.current = false;
          }}
          className={cx(
            "w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 border-border bg-popover p-1.5",
            contentClassName,
          )}
        >
          <DropdownMenuLabel className="kicker text-clay-muted">
            {t({ id: "localeSwitcher.menu.label", message: "Language" })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={currentLocale}
            onValueChange={onValueChange}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <DropdownMenuRadioItem
                key={locale}
                value={locale}
                disabled={isPending}
              >
                {getLocaleLabel(locale)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
