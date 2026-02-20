# Locale Switcher: shadcn DropdownMenu + Cursor Fix

## Background

The locale switcher in `apps/web/src/components/layout/locale-switcher.tsx` used a native `select` with custom icon overlays.
This caused two UX issues:

- icon hover/open feedback was weak and inconsistent with the surrounding clay button system
- dropdown visual quality and interaction polish lagged behind the rest of the header

The user also requested a global cursor interaction fix so menu/select controls show pointer affordance correctly.

## Goals

- Replace native `select` locale picker with a shadcn-style Radix `DropdownMenu` radio selection pattern.
- Preserve existing locale routing behavior (path locale replacement + query/hash preservation).
- Improve trigger and icon hover/open states.
- Add global cursor rules for `select` and menu item roles.
- Keep current clay visual language and avoid unrelated header refactors.

## Scope

In scope:

- `apps/web/src/components/layout/locale-switcher.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx` (new)
- `apps/web/src/components/ui/index.ts`
- `apps/web/src/styles/custom.css`
- `apps/web/package.json` dependency addition

Out of scope:

- changing site header layout structure
- adding new locales, translation keys, or i18n message schema changes
- broad visual redesign outside locale switcher and menu primitive

## Solution

1. Add `@radix-ui/react-dropdown-menu` dependency in `apps/web`.
2. Create a reusable shadcn-style dropdown-menu primitive wrapper under `apps/web/src/components/ui/dropdown-menu.tsx`:
   - `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`
   - `DropdownMenuLabel`, `DropdownMenuSeparator`
   - `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuItemIndicator`
3. Refactor `LocaleSwitcher`:
   - use a button trigger styled with existing clay classes
   - keep globe and chevron icons with synchronized hover/focus/open transitions
   - render locale choices with `DropdownMenuRadioGroup`
   - keep current `replaceLocalePath + query + hash + router.replace` logic
   - avoid navigation when selected locale equals current locale
   - disable trigger/items while transition is pending
4. Extend global cursor rules in `custom.css`:
   - pointer for interactive `button`, `select`, and menu roles
   - not-allowed for disabled `button`, `select`, and aria-disabled menu roles

## Risks

- Visual mismatch between popover shadow and clay surfaces.
- Menu cursor selectors might be too broad if unrelated elements reuse role attributes.
- Pending state could feel unresponsive if disable styles are too subtle.

## Acceptance Criteria

- Locale switching works for `en` and `zh` routes.
- Query string and hash are preserved after locale switch.
- Choosing the current locale does not trigger navigation.
- Trigger and menu items show pointer cursor in enabled state.
- Trigger icons clearly respond on hover/focus/open.
- Dropdown keyboard interaction works (open, navigate, select, close).
- `pnpm -C apps/web lint`, `pnpm -C apps/web typecheck`, and `pnpm -C apps/web build` pass.
