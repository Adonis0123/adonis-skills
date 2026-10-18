"use client";

import { useLingui } from "@lingui/react/macro";
import { useTheme } from "next-themes";
import { ClayButton } from "@/components/ui";
import { cx } from "@/components/ui/utils";

interface ThemeToggleProps {
  /** Show the action text next to the icon (mobile sheet). Icon-only otherwise. */
  showLabel?: boolean;
  buttonClassName?: string;
}

/*
 * Two-state light/dark toggle; with no stored choice next-themes follows the system.
 * Icons and labels for both states are always in the markup and the `.dark` class on
 * <html> (set by next-themes before paint) picks the visible pair, so server and client
 * render the same tree and the right icon shows from the first frame.
 * `display: none` also drops the hidden label from the accessible name.
 */
export function ThemeToggle({
  showLabel = false,
  buttonClassName,
}: ThemeToggleProps) {
  const { t } = useLingui();
  const { resolvedTheme, setTheme } = useTheme();

  const toDarkLabel = t({
    id: "themeToggle.switchToDark",
    message: "Switch to dark theme",
  });
  const toLightLabel = t({
    id: "themeToggle.switchToLight",
    message: "Switch to light theme",
  });
  const iconClassName =
    "size-4 shrink-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-75 motion-safe:duration-200";

  return (
    <ClayButton
      type="button"
      variant="ghost"
      size={showLabel ? "sm" : "icon"}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cx(showLabel && "px-3.5 text-xs md:text-sm", buttonClassName)}
    >
      {/* The icon previews the target theme, matching the action label. */}
      <span
        className={cx("icon-[lucide--moon-star] dark:hidden", iconClassName)}
        aria-hidden
      />
      <span
        className={cx(
          "icon-[lucide--sun-medium] hidden dark:inline-block",
          iconClassName,
        )}
        aria-hidden
      />
      <span className={cx("dark:hidden", !showLabel && "sr-only")}>
        {toDarkLabel}
      </span>
      <span className={cx("hidden dark:inline", !showLabel && "dark:sr-only")}>
        {toLightLabel}
      </span>
    </ClayButton>
  );
}
