# README Bilingual Policy

## Background

The repository currently has README files in Chinese only. This causes inconsistent default language expectations for contributors and external readers.

## Goals

- Standardize README documentation to bilingual files.
- Keep English as the default canonical README.
- Ensure Chinese documentation is always available as a synchronized mirror.
- Prevent language drift between English and Chinese documentation.

## Scope

In scope:

- Root README files.
- `apps/web` README files.
- Repository-wide rule updates in `.ruler` for future README changes.

Out of scope:

- Non-README documentation files.
- i18n strategy for app runtime copy.

## Proposed Solution

- Adopt file naming convention in every directory with README docs:
  - `README.md` (English, default canonical)
  - `README.zh-CN.md` (Chinese mirror)
- Require reciprocal language switch links at the top of both files.
- Keep section order, command examples, and semantic meaning aligned between both languages.
- Require that any README update modifies both language files in the same change.
- Encode this policy in `.ruler/30-coding-conventions.md`, then regenerate `AGENTS.md` and `CLAUDE.md` through `pnpm ruler:apply`.

## Risks

- Contributors may update only one language file and cause divergence.
- New directories may add single-language README files without following the standard.

## Acceptance Criteria

- Root has both `README.md` and `README.zh-CN.md` with top language links.
- `apps/web` has both `README.md` and `README.zh-CN.md` with top language links.
- English README is the default version (`README.md`) in each directory.
- `.ruler/30-coding-conventions.md` contains explicit bilingual README policy.
- `pnpm ruler:apply` completes and updates generated rule outputs.
