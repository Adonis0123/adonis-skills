import type { CSSProperties } from "react";
import { cx } from "@/components/ui/utils";

interface SectionRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  offsetY?: number;
}

/**
 * CSS-only entrance (styles/effects-layout.css `.section-reveal`). It starts
 * on first paint instead of after hydration, so server-rendered content is
 * never held at `opacity: 0`, and reduced motion shows it at once.
 */
export function SectionReveal({
  children,
  className,
  delay = 0,
  offsetY = 8,
}: SectionRevealProps) {
  const style = {
    "--reveal-delay": `${Math.max(0, delay)}ms`,
    "--reveal-offset": `${offsetY}px`,
  } as CSSProperties;

  return (
    <div className={cx("section-reveal", className)} style={style}>
      {children}
    </div>
  );
}
