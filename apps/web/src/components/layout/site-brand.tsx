import Image from 'next/image'
import Link from 'next/link'
import type { SiteBrand as SiteBrandConfig } from '@/config/site-layout'
import { cx } from '@/components/ui/utils'

export interface SiteBrandProps {
  brand: SiteBrandConfig
  variant: 'header' | 'footer'
  subtitle?: string
  priority?: boolean
  className?: string
}

export function SiteBrand({
  brand,
  variant,
  subtitle,
  priority = false,
  className,
}: SiteBrandProps) {
  const isHeader = variant === 'header'
  const logoSize = isHeader ? 32 : 24

  return (
    <Link
      href="/"
      className={cx(
        'group clay-focus-ring inline-flex items-center rounded-xl transition-opacity hover:opacity-90',
        isHeader ? 'gap-3' : 'gap-2.5',
        className,
      )}
    >
      <Image
        src={brand.logoSrc}
        alt={brand.logoAlt}
        width={logoSize}
        height={logoSize}
        priority={priority}
        className={cx(
          'object-contain transition-transform duration-200 ease-out group-hover:-translate-y-px',
          isHeader ? 'size-8' : 'size-6',
        )}
      />

      {isHeader ? (
        <span className="min-w-0">
          <span className="block text-lg leading-none">{brand.name}</span>
          {subtitle ? (
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-clay-muted">
              {subtitle}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-lg leading-none">{brand.name}</span>
      )}
    </Link>
  )
}
