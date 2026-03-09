# Lingui Locale Activation and Skill Sync Plan (2026-02-20)

## Background

The web app hit runtime errors in Next.js App Router server paths:

`Lingui: Attempted to call a translation function without setting a locale`

The issue appeared in server-rendered metadata and shared server components where translation calls could run before locale activation in concurrent RSC execution paths.

At the same time, repository skills (`lingui-next-init`, `lingui-workflow`, `lingui-best-practices`) still described a layout-first initialization model that can reintroduce the same bug in newly scaffolded projects.

## Goals

1. Eliminate locale-not-activated runtime errors in `apps/web`.
2. Make server-side locale initialization deterministic in App Router.
3. Sync all related skills so new projects and daily workflows follow the same safe pattern.
4. Preserve existing public APIs and keep changes minimal.

## Scope

In scope:

1. `apps/web` server i18n runtime and server component translation call sites.
2. `skills/lingui-next-init` and `.agents/skills/lingui-next-init` templates and docs.
3. `skills/lingui-workflow` troubleshooting guidance.
4. `.agents/skills/lingui-best-practices` RSC-specific guidance.

Out of scope:

1. New i18n features.
2. Non-Lingui frontend feature work.
3. Behavior changes to routing strategy beyond i18n initialization correctness.

## Solution

### 1. Runtime initialization fix (`apps/web`)

1. Update `initLingui(locale)` to call `i18n.activate(locale)` before `setI18n(i18n)`.
2. Ensure server pages initialize locale with `initPageLingui(params)`.
3. Remove server-side reliance on global `@lingui/core/macro` `t()` where possible.
4. Use request-bound i18n instance translation (`i18n._`) in metadata and server page string generation.

### 2. Skill template fix (`lingui-next-init`)

1. Update template `web/src/i18n/initLingui.ts.tpl` in both `skills/` and `.agents/skills/` to include `i18n.activate(locale)`.
2. Update App Router workflow references to explicitly require initialization in both server layouts and server pages.
3. Add troubleshooting notes for the locale-not-set error and recommended mitigation steps.

### 3. Workflow and best-practices documentation sync

1. Add locale-not-set troubleshooting checklist to `skills/lingui-workflow` docs.
2. Add App Router/RSC specific section to `.agents/skills/lingui-best-practices/SKILL.md`.
3. Add a dedicated common-mistake section for missing server locale initialization in App Router.

## Risks

1. Existing code paths that still use global translation calls in server boundaries may fail in future refactors.
2. Documentation drift can recur if only one copy (`skills/` vs `.agents/skills/`) is updated.
3. Generated locale artifacts may trigger lint warnings unrelated to this fix.

## Acceptance Criteria

1. `pnpm -C apps/web typecheck` passes.
2. `pnpm -C apps/web lint` has no new errors introduced by this change.
3. `apps/web` no longer throws locale-not-set runtime errors at known server metadata/page points.
4. `lingui-next-init` templates now generate `initLingui` with explicit activation.
5. Related skills include explicit guidance: server layout + server page initialization and RSC-safe translation patterns.
6. Skills validation and index regeneration complete successfully.
