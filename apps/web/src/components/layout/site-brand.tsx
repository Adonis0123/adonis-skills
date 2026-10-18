import Image from "next/image";
import { useLingui } from "@lingui/react/macro";
import type { SiteBrand as SiteBrandConfig } from "@/config/site-layout";
import { cx } from "@/components/ui/utils";
import { LocaleLink } from "@/i18n/locale-link";

// Lowercase wordmark set in Shantell Sans 800, matching the brand's project wordmarks.
function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "font-display leading-none font-extrabold tracking-[-0.01em]",
        className,
      )}
    >
      nika <span className="text-link">skills</span>
    </span>
  );
}

export interface SiteBrandProps {
  brand: SiteBrandConfig;
  variant: "header" | "footer";
  subtitle?: React.ReactNode;
  priority?: boolean;
  className?: string;
}

export function SiteBrand({
  brand,
  variant,
  subtitle,
  priority = false,
  className,
}: SiteBrandProps) {
  const { t } = useLingui();
  const isHeader = variant === "header";
  const logoSize = isHeader ? 32 : 28;

  return (
    <LocaleLink
      href="/"
      className={cx(
        "group clay-focus-ring inline-flex items-center rounded-xl transition-opacity hover:opacity-90",
        "gap-2.5",
        className,
      )}
    >
      <Image
        src={brand.logoSrc}
        alt={t({
          id: "siteBrand.logoAlt",
          message: "Kiki, the Nika Skills character",
        })}
        width={logoSize}
        height={logoSize}
        priority={priority}
        unoptimized
        className={cx(
          "object-contain transition-transform duration-200 ease-out group-hover:-translate-y-px",
          isHeader ? "size-8" : "size-7",
        )}
      />

      {isHeader ? (
        <span className="min-w-0">
          <BrandWordmark className="block text-xl" />
          {subtitle ? (
            <span className="kicker mt-1 block text-clay-muted">
              {subtitle}
            </span>
          ) : null}
        </span>
      ) : (
        <BrandWordmark className="text-xl" />
      )}
    </LocaleLink>
  );
}
