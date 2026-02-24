# Tailwind CSS Documentation Sync

This file tracks the latest Tailwind CSS documentation references for annual updates.

## Official Documentation Links

**Last Updated**: 2026-02-24

### Core Documentation
- [Tailwind CSS Official Docs](https://tailwindcss.com/docs) - Main documentation
- [Installation Guide](https://tailwindcss.com/docs/installation)
- [Configuration](https://tailwindcss.com/docs/configuration)
- [Customization](https://tailwindcss.com/docs/theme)

### Best Practices
- [Reusing Styles](https://tailwindcss.com/docs/reusing-styles)
- [Adding Custom Styles](https://tailwindcss.com/docs/adding-custom-styles)
- [Functions & Directives](https://tailwindcss.com/docs/functions-and-directives)
- [Optimizing for Production](https://tailwindcss.com/docs/optimizing-for-production)

### Modern Features
- [Container Queries](https://tailwindcss.com/docs/hover-focus-and-other-states#container-queries)
- [Arbitrary Variants](https://tailwindcss.com/docs/hover-focus-and-other-states#using-arbitrary-variants)
- [Dynamic Breakpoints](https://tailwindcss.com/docs/responsive-design)
- [Dark Mode](https://tailwindcss.com/docs/dark-mode)

### Plugins
- [Official Plugins](https://tailwindcss.com/docs/plugins)
- [Typography Plugin](https://tailwindcss.com/docs/typography-plugin)
- [Forms Plugin](https://github.com/tailwindlabs/tailwindcss-forms)
- [Aspect Ratio Plugin](https://github.com/tailwindlabs/tailwindcss-aspect-ratio)
- [Line Clamp Plugin](https://github.com/tailwindlabs/tailwindcss-line-clamp)

### Tools & Integrations
- [Prettier Plugin](https://github.com/tailwindlabs/prettier-plugin-tailwindcss) - Auto-sort classes
- [ESLint Plugin](https://github.com/francoismassart/eslint-plugin-tailwindcss) - Lint Tailwind classes
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss) - IntelliSense
- [Headless UI](https://headlessui.com/) - Unstyled accessible components
- [Heroicons](https://heroicons.com/) - SVG icons

## Version Compatibility

### Tailwind CSS v4 (Current Baseline)
- CSS-first setup using `@import "tailwindcss"`
- Theme tokens and extensions can live in CSS via `@theme`
- Utility and variant customization can use `@utility` and `@custom-variant`
- Automatic source detection is default; add `@source` when your classes live outside default scan roots

### Tailwind CSS v3 (Legacy but Supported)
- Config-first setup centered on `tailwind.config.js`
- Uses `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;`
- JIT/content scanning depends on correct `content` paths in config
- Widely used in existing production projects and migration scenarios

### Detection Signals Used by This Skill
- Check `package.json` dependency first (`tailwindcss` major version 4 or 3)
- Cross-check syntax/config signals:
  - v4 signals: `@import "tailwindcss"`, `@theme`, `@utility`, `@custom-variant`
  - v3 signals: `@tailwind base/components/utilities` with config-driven structure
- Mark as `conflict` when dependency and syntax signals disagree
- Mark as `unknown` when evidence is insufficient

## Browser Support Snapshot

Browser support changes continuously. Treat percentages as time-sensitive:

- Use [Can I Use](https://caniuse.com/) for real-time compatibility checks.
- Validate against your product browser matrix before enabling modern-only patterns.
- Prefer progressive enhancement for newer features (`:has()`, subgrid, container queries).

## Annual Update Checklist

When updating this skill annually (recommended: every January):

### 1. Documentation Review
- [ ] Review Tailwind CSS release notes for the past year
- [ ] Check for new utility classes
- [ ] Verify deprecated features
- [ ] Update configuration examples if syntax changed
- [ ] Re-run version detection rules against representative v3/v4/conflict/unknown samples

### 2. Browser Compatibility
- [ ] Refresh browser support notes from Can I Use
- [ ] Review new CSS features adopted by Tailwind
- [ ] Check container query and modern CSS support

### 3. Tools & Ecosystem
- [ ] Verify Prettier plugin compatibility
- [ ] Check ESLint plugin updates
- [ ] Review new official plugins
- [ ] Update VS Code extension recommendations

### 4. Best Practices
- [ ] Review Tailwind blog for new recommendations
- [ ] Check community best practices (GitHub, Twitter, Discord)
- [ ] Update performance optimization techniques
- [ ] Verify accessibility guidelines (WCAG updates)

### 5. Examples & Code
- [ ] Test all code examples with latest Tailwind version
- [ ] Update deprecated class names
- [ ] Add examples for new features
- [ ] Remove outdated workarounds

## Community Resources

### Official
- [Tailwind Blog](https://tailwindcss.com/blog)
- [Tailwind Discord](https://tailwindcss.com/discord)
- [Tailwind GitHub](https://github.com/tailwindlabs/tailwindcss)

### Learning
- [Tailwind Play](https://play.tailwindcss.com/) - Online playground
- [Tailwind UI](https://tailwindui.com/) - Official component library (paid)
- [Tailwind Components](https://tailwindcomponents.com/) - Community components
- [Awesome Tailwind CSS](https://github.com/aniftyco/awesome-tailwindcss) - Curated list

### Blogs & Tutorials
- [Adam Wathan (Creator)](https://twitter.com/adamwathan)
- [Tailwind CSS Weekly](https://tailwindcss.com/blog)
- [Tailwind Strategies](https://www.youtube.com/@TailwindLabs)

## Migration Guide Template

When Tailwind releases a major version:

```bash
# Install latest version
npm install -D tailwindcss@latest

# Update PostCSS config if needed
# Update tailwind.config.js

# Run codemod (if available)
npx @tailwindcss/upgrade

# Check for breaking changes
# Review release notes: https://github.com/tailwindlabs/tailwindcss/releases

# Test build
npm run build

# Fix deprecation warnings
# Update custom plugin code if applicable
```

## Notes for Skill Maintainers

- Keep SKILL.md concise by moving implementation-heavy examples here
- Update this file annually in January
- Add new sections as Tailwind evolves
- Document breaking changes prominently
- Maintain backward compatibility examples when possible
