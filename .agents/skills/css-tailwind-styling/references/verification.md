# Verification Detail

Read only the sections selected by [the skill entry](../SKILL.md). These detailed recipes remain subject to the requested scope, established version, and existing project conventions.

## Contents

- [Performance Optimization](#performance-optimization)
  - [1. Minimize and Compress](#1-minimize-and-compress)
  - [2. Critical CSS Inlining](#2-critical-css-inlining)
  - [3. Avoid Expensive Properties](#3-avoid-expensive-properties)
  - [4. Use will-change Sparingly](#4-use-will-change-sparingly)
- [Accessibility Best Practices](#accessibility-best-practices)
  - [1. Color Contrast](#1-color-contrast)
  - [2. Focus Indicators](#2-focus-indicators)
  - [3. Screen Reader Only Content](#3-screen-reader-only-content)
  - [4. Reduced Motion](#4-reduced-motion)
- [Browser Compatibility](#browser-compatibility)
  - [1. Vendor Prefixes](#1-vendor-prefixes)
  - [2. Feature Detection](#2-feature-detection)
  - [3. Check Browser Support](#3-check-browser-support)
- [Quick Reference Checklist](#quick-reference-checklist)
  - [Before Writing Styles](#before-writing-styles)
  - [While Writing Styles](#while-writing-styles)
  - [Tailwind-Specific](#tailwind-specific)
  - [Before Committing](#before-committing)
- [Tools and Resources](#tools-and-resources)
  - [Essential Tools](#essential-tools)
  - [Testing Tools](#testing-tools)
  - [Documentation](#documentation)

---

## Performance Optimization

### 1. Minimize and Compress

```bash
# Use cssnano
npm install -D cssnano postcss-cli

# postcss.config.js
module.exports = {
  plugins: [
    require('cssnano')({
      preset: 'default',
    })
  ]
}
```

### 2. Critical CSS Inlining

```html
<head>
  <!-- Inline critical CSS for above-the-fold content -->
  <style>
    body {
      margin: 0;
      font-family: sans-serif;
    }
    .header {
      background: #fff;
      height: 60px;
    }
    .hero {
      min-height: 100vh;
    }
  </style>

  <!-- Load remaining CSS asynchronously -->
  <link
    rel="preload"
    href="main.css"
    as="style"
    onload="this.onload=null;this.rel='stylesheet'"
  />
  <noscript><link rel="stylesheet" href="main.css" /></noscript>
</head>
```

### 3. Avoid Expensive Properties

```css
/* ❌ EXPENSIVE: Triggers layout/paint */
.expensive {
  width: 100px;
  height: 100px;
  top: 100px;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
}

/* ✅ CHEAPER: Only triggers composite */
.optimized {
  transform: scale(1.1) translateY(10px);
  opacity: 0.9;
}
```

**Performance Tiers**:

- ⚡ Cheapest: `opacity`, `transform`, `filter`
- ⚠️ Moderate: color, background-color
- 🐌 Expensive: width, height, padding, margin, border
- 🔥 Very Expensive: properties triggering reflow on complex layouts

### 4. Use will-change Sparingly

```css
/* ❌ BAD: Overuse creates memory issues */
* {
  will-change: transform;
}

/* ✅ GOOD: Only during animation */
.element {
  transition: transform 0.3s;
}

.element:hover {
  will-change: transform;
  transform: translateY(-5px);
}

.element:not(:hover) {
  will-change: auto; /* Remove after animation */
}
```

---

## Accessibility Best Practices

### 1. Color Contrast

```css
/* ✅ GOOD: High contrast (WCAG AA: 4.5:1) */
.text-on-dark {
  background-color: #000;
  color: #fff; /* Contrast: 21:1 */
}

/* ⚠️ WARNING: Low contrast (WCAG fail) */
.text-low-contrast {
  background-color: #ccc;
  color: #ddd; /* Contrast: 1.5:1 - FAIL */
}
```

**Tools**:

- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- Browser DevTools (Chrome, Firefox have built-in checkers)

### 2. Focus Indicators

```css
/* ❌ BAD: Remove focus outline */
button:focus {
  outline: none; /* Never do this without replacement */
}

/* ✅ GOOD: Custom focus style */
button:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.5);
}

/* ✅ BETTER: Use :focus-visible */
button:focus-visible {
  outline: 2px solid #4299e1;
  outline-offset: 2px;
}
```

### 3. Screen Reader Only Content

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

Usage:

```html
<button>
  <span class="sr-only">Close modal</span>
  <svg>...</svg>
</button>
```

### 4. Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Browser Compatibility

### 1. Vendor Prefixes

Use [Autoprefixer](https://github.com/postcss/autoprefixer) - don't write manually:

```bash
npm install -D autoprefixer
```

```javascript
// postcss.config.js
module.exports = {
  plugins: [require("autoprefixer")],
};
```

### 2. Feature Detection

```css
/* Modern feature with fallback */
.element {
  background-color: #1da1f2; /* Fallback */
  background-color: oklch(59.69% 0.217 237.04); /* Modern */
}

/* Using @supports */
@supports (display: grid) {
  .layout {
    display: grid;
  }
}

@supports not (display: grid) {
  .layout {
    display: flex;
  }
}
```

### 3. Check Browser Support

Always verify on [Can I Use](https://caniuse.com/) before using new features.
Avoid hardcoding percentages in guidance docs because support changes over time.

Current recommendation:

- Use modern features by default only when target browsers are explicitly supported by your product matrix.
- Add fallbacks (or progressive enhancement) for features like `:has()` and subgrid when compatibility is uncertain.

---

## Quick Reference Checklist

### Before Writing Styles

- [ ] Following the established styling system? For new setup only: is Tailwind appropriate?
- [ ] Is there an existing style guide to follow?
- [ ] What's the browser support requirement?
- [ ] Mobile-first or desktop-first?

### While Writing Styles

- [ ] Using semantic class names (BEM/SMACSS)?
- [ ] Following property ordering convention?
- [ ] Keeping specificity low?
- [ ] Using CSS variables for design tokens?
- [ ] Implementing mobile-first breakpoints?
- [ ] Ensuring WCAG AA color contrast?
- [ ] Adding focus indicators?
- [ ] Supporting reduced motion?

### Tailwind-Specific

- [ ] Detected version state (`v3` / `v4` / `conflict` / `unknown`)?
- [ ] Classes follow the existing formatter/order convention?
- [ ] Using shorthand utilities (mx, py)?
- [ ] Avoiding string interpolation for classes?
- [ ] Using predefined variants instead of arbitrary classes?
- [ ] Version-appropriate config strategy applied?
- [ ] v3: `content` paths complete? v4: `@source` added when required?
- [ ] Applicable existing lint checks pass? Extra plugins are not prerequisites for local fixes.

### Before Committing

- [ ] No unused utilities (v3: content/JIT, v4: auto-detection + optional `@source`)?
- [ ] Minified for production?
- [ ] Critical CSS inlined if needed?
- [ ] Accessibility tested (keyboard navigation, screen reader)?
- [ ] Responsive tested on multiple screen sizes?
- [ ] Cross-browser tested?

---

## Tools and Resources

### Essential Tools

- **Prettier + Tailwind Plugin**: Auto-format class ordering
- **ESLint + Tailwind Plugin**: Lint Tailwind classes
- **Autoprefixer**: Auto-add vendor prefixes
- **cssnano**: Minify CSS
- **Can I Use**: Check browser support

### Testing Tools

- **WebAIM Contrast Checker**: Color contrast
- **WAVE**: Accessibility testing
- **Lighthouse**: Performance and accessibility audit
- **BrowserStack**: Cross-browser testing

### Documentation

- [MDN CSS Reference](https://developer.mozilla.org/en-US/docs/Web/CSS)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [CSS-Tricks](https://css-tricks.com/)
- [Web.dev Learn CSS](https://web.dev/learn/css/)

---
