"use client";

import { useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import { CopyInstallCommandButton } from "@/components/copy-install-command";
import {
  FilterTransitionItem,
  FilterTransitionList,
} from "@/components/motion/filter-transition";
import { HoverFx } from "@/components/motion/hover-fx";
import { RowHighlight } from "@/components/motion/row-highlight";
import { cx } from "@/components/ui/utils";
import { SKILL_TAG_LABELS } from "@/config/skill-tags";
import { resolveLocaleValue } from "@/i18n/config";
import { LocaleLink } from "@/i18n/locale-link";
import { getSkillInstallCommand, type SkillListItem } from "@/lib/skills";

export interface SkillRowProps {
  skill: SkillListItem;
  /** Zero-based position in its list; shown as a two-digit number (01, 02, …). */
  index: number;
}

/**
 * Dense catalog row (after coco-skills' SkillRow; styles in effects-rows.css):
 * number · Display Name, mono slug and the summary on one truncated line ·
 * two tags · an arrow. 48px tall from `md`, hovered or not. The title link
 * stretches over the row; on hover / keyboard focus the tags slide up and out
 * and the install command with its copy button (above the stretched link)
 * takes the same grid cell, the left bar grows, the number turns `--link` and
 * the arrow moves 3px. The list's one sliding highlight (RowHighlight) sits
 * behind it. Below `md` the row is two lines (name, summary) and drops the
 * tags and command; on touch screens the command replaces the tags for good.
 */
export function SkillRow({ skill, index }: SkillRowProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const { catalog } = skill;
  const summary = locale === "zh" ? catalog.summary_zh : catalog.summary;
  const displayName = catalog.displayName[locale];
  const command = getSkillInstallCommand(skill.slug);

  return (
    <div className="list-row skill-row clay-focus-link-ring">
      <span aria-hidden className="row-indicator" />
      <span aria-hidden className="row-index type-mono">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="skill-row-main">
        <h3 className="skill-row-title type-card-title">
          <LocaleLink
            href={`/skills/${skill.slug}`}
            className="outline-none after:absolute after:inset-0 after:z-[1] after:content-['']"
          >
            {displayName}
          </LocaleLink>
        </h3>
        <span className="skill-row-slug type-mono">{skill.slug}</span>
        <p className="skill-row-summary" title={summary}>
          {summary}
        </p>
      </div>
      <div className="row-reveal">
        <ul
          className="row-meta"
          aria-label={t({ id: "skillCard.tags.aria", message: "Tags" })}
        >
          {catalog.tags.slice(0, 2).map((tag, tagIndex) => (
            <li
              key={tag}
              className={tagIndex === 0 ? "nk-tag" : "nk-tag nk-tag--neutral"}
            >
              {SKILL_TAG_LABELS[tag][locale]}
            </li>
          ))}
        </ul>
        {/* An `fx-surface` only so a copy runs one beam lap round the command (playBeamLapAround). */}
        <div className="row-cmd fx-surface">
          <HoverFx dots={false} />
          <code className="row-cmd-text type-mono" title={command}>
            <span className="text-link" aria-hidden>
              ${" "}
            </span>
            {command}
          </code>
          <CopyInstallCommandButton
            variant="outline"
            command={command}
            label={t({
              id: "skillCard.copy.ariaLabel",
              message: `Copy install command for ${displayName}`,
            })}
          />
        </div>
      </div>
      <span aria-hidden className="row-arrow icon-[lucide--arrow-right]" />
    </div>
  );
}

export interface SkillListProps {
  skills: SkillListItem[];
  /** Number shown on the first row minus one (default 0, so rows read 01, 02, …). */
  startIndex?: number;
  className?: string;
}

/**
 * Framed list of SkillRows (hand-drawn `.ink-box`, no `overflow-*`, so the
 * outline keeps its waver) with ONE sliding highlight behind the rows.
 * Rows re-flow on filter changes through FilterTransitionList / Item (keyed
 * by slug); rows are separated by plain `--border` lines.
 */
export function SkillList({
  skills,
  startIndex = 0,
  className,
}: SkillListProps) {
  const listRef = useRef<HTMLElement>(null);
  return (
    <div className={cx("skill-list ink-box bg-card", className)}>
      <div className="relative">
        <RowHighlight listRef={listRef} />
        <FilterTransitionList
          as="ul"
          ref={listRef}
          data-skill-results
          className="divide-y divide-border"
        >
          {skills.map((skill, index) => (
            <FilterTransitionItem
              as="li"
              key={skill.slug}
              index={index}
              data-slug={skill.slug}
              className="min-w-0"
            >
              <SkillRow skill={skill} index={startIndex + index} />
            </FilterTransitionItem>
          ))}
        </FilterTransitionList>
      </div>
    </div>
  );
}
