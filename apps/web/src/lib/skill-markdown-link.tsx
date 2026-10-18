"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { resolveLocaleValue } from "@/i18n/config";
import {
  resolveSkillMarkdownHref,
  type SkillLinkContext,
} from "@/lib/skill-link";

interface SkillLinkSourceProps {
  repo: string;
  /** Set by the server when the link points at another skill that has a page here. */
  publicSkill?: string;
}

// The page params say which skill and locale the markdown belongs to, the same way
// LocaleLink reads the locale, so callers of renderSectionContent pass nothing extra.
function useSkillLinkContext({
  repo,
  publicSkill,
}: SkillLinkSourceProps): Omit<SkillLinkContext, "asset"> {
  const params = useParams();
  const slug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug;
  return {
    repo,
    slug,
    locale: resolveLocaleValue(params?.lang),
    isPublicSkill: (candidate) => candidate === publicSkill,
  };
}

export function SkillMarkdownLink({
  href,
  className,
  children,
  ...source
}: SkillLinkSourceProps & {
  href?: string;
  className?: string;
  children?: ReactNode;
}) {
  const context = useSkillLinkContext(source);
  const resolved = resolveSkillMarkdownHref(href, context);
  return (
    <a
      href={resolved.href}
      target={resolved.external ? "_blank" : undefined}
      rel={resolved.external ? "noopener noreferrer" : undefined}
      className={className}
    >
      {children}
    </a>
  );
}

export function SkillMarkdownImage({
  src,
  alt,
  title,
  className,
  ...source
}: SkillLinkSourceProps & {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
}) {
  const context = useSkillLinkContext(source);
  const resolved = resolveSkillMarkdownHref(src, { ...context, asset: true });
  if (!resolved.href) return null;
  return (
    // SKILL.md images live on GitHub with unknown sizes, so next/image cannot size them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved.href}
      alt={alt ?? ""}
      title={title}
      loading="lazy"
      className={className}
    />
  );
}
