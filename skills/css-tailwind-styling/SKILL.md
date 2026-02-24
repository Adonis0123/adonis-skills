---
name: css-tailwind-styling
description: Expert guidance for writing clean, performant CSS and Tailwind CSS. Use when creating styles, designing components, optimizing performance, or establishing styling conventions. Covers modern CSS features, Tailwind utility patterns, responsive design, accessibility, and team collaboration standards.
---

# CSS and Tailwind CSS Styling Expert

## Overview

This skill provides comprehensive best practices for writing maintainable, performant, and accessible styles using both traditional CSS and Tailwind CSS. It covers modern techniques, performance optimization, responsive design patterns, and team collaboration standards.

## When to Use This Skill

- Creating or refactoring component styles
- Setting up a new project's styling architecture
- Optimizing CSS or Tailwind performance
- Establishing team styling conventions
- Reviewing code for style-related issues
- Implementing responsive designs
- Ensuring accessibility compliance
- Debugging style conflicts or specificity issues

## Core Principles

### General Styling Philosophy

1. **Maintainability First**: Write styles that are easy to understand and modify
2. **Performance Conscious**: Minimize bundle size and render-blocking
3. **Accessibility By Default**: Ensure WCAG AA compliance (4.5:1 contrast ratio minimum)
4. **Mobile-First Responsive**: Start with mobile and progressively enhance
5. **Consistency Over Cleverness**: Establish and follow patterns

---

## Version Detection & Decision Flow

Use this protocol before giving Tailwind-specific guidance.

### 1. Detect Tailwind Version (Dependency First)

Inspect `package.json` first:

- `tailwindcss` major version `4` -> initial state: `v4`
- `tailwindcss` major version `3` -> initial state: `v3`
- Missing/unclear dependency -> initial state: `unknown` (continue with signal checks)

### 2. Cross-Check with Configuration and Style Signals

Use these signals to validate or refine the initial state:

- Prefer **v4** when you find: `@import "tailwindcss"`, `@theme`, `@utility`, `@custom-variant`
- Prefer **v3** when you find: `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;` with a config-driven setup

### 3. Resolve Final State

- `v4`: dependency and signals align to v4
- `v3`: dependency and signals align to v3
- `conflict`: dependency and syntax/config signals disagree
- `unknown`: insufficient evidence to identify a single version

### 4. Required Decision Behavior

- `v4`: Provide v4 as **Primary Path**, include v3 as **Alternate Path**
- `v3`: Provide v3 as **Primary Path**, include v4 as **Alternate Path**
- `conflict`: Do not stop; provide both repair paths and a recommended path in **Conflict Fix**
- `unknown`: Provide both paths, default recommendation is v4 for new projects

---

## Tailwind CSS Best Practices

### 1. Prerequisites for Tailwind Projects

Prefer Tailwind when at least one of these is true:

- ✅ The team needs fast UI iteration with shared utility patterns
- ✅ The project already has reusable components or design tokens
- ✅ Consistent styling conventions are difficult to enforce with ad hoc CSS

Prefer traditional CSS (or CSS Modules) when the UI scope is small, mostly static,
or the team is not ready to maintain a shared utility vocabulary yet.

### 2. Class Ordering and Organization

Use the **Concentric CSS** ordering method for utility classes:

```jsx
// ✅ GOOD: Ordered classes
<div className="
  relative z-10                          // 1. Positioning
  flex items-center                      // 2. Display & Box Model
  w-full max-w-screen-lg mx-auto px-4   // 3. Sizing & Spacing
  border border-gray-200 rounded-lg      // 4. Borders
  bg-white shadow-md                     // 5. Backgrounds
  text-lg font-semibold text-gray-900    // 6. Typography
  transition-all duration-200            // 7. Other
">

// ❌ BAD: Random ordering
<div className="text-lg bg-white flex border w-full shadow-md px-4">
```

**Automation**: Always recommend the [Prettier Plugin for Tailwind CSS](https://github.com/tailwindlabs/prettier-plugin-tailwindcss):

```bash
npm install -D prettier prettier-plugin-tailwindcss
```

```json
// .prettierrc
{
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

### 3. Minimize Utility Classes

```jsx
// ❌ BAD: Redundant classes
<div className="ml-2 mr-2 pt-4 pb-4 pl-4 pr-4">

// ✅ GOOD: Use shorthand
<div className="mx-2 py-4 px-4">

// ✅ BETTER: Combine where possible
<div className="mx-2 p-4">

// ❌ BAD: Unnecessary default values
<div className="block lg:flex flex-row justify-center">

// ✅ GOOD: Omit defaults (flex-row is default)
<div className="block lg:flex justify-center">
```

### 4. Responsive Design Prefixes

Use mobile-first defaults and add prefixes only for breakpoint-specific overrides:

```jsx
// ❌ BAD: Duplicates intent and makes defaults harder to read
<div className="flex flex-col justify-center lg:flex lg:flex-col lg:justify-center">

// ✅ GOOD: Base styles stay unprefixed, only overrides use breakpoints
<div className="flex flex-col justify-center lg:flex-row lg:justify-between">
```

### 5. Component Abstraction Strategy

**Priority: Components > @apply**

```jsx
// ❌ BAD: Overuse of @apply
.btn-primary {
  @apply bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700;
}

// ✅ GOOD: Create reusable component
function Button({ children, variant = 'primary' }) {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };

  return (
    <button className={`px-4 py-2 rounded-lg font-medium transition-colors ${variants[variant]}`}>
      {children}
    </button>
  );
}
```

**When to use @apply**:
- ✅ Truly duplicated utility patterns across multiple components
- ✅ Creating base resets or normalizations
- ❌ NOT for single-use component styles
- ❌ NOT chaining component classes (`.btn-blue { @apply btn; }`)

### 6. Tailwind Configuration (v3/v4)

Use version-appropriate configuration patterns and keep design tokens centralized.

**v3 (config-first):**

```javascript
// tailwind.config.js
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './public/index.html',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1DA1F2',
          secondary: '#14171A',
          accent: '#1DA1F2',
        },
      },
      spacing: {
        '128': '32rem',
        '144': '36rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

**v4 (CSS-first):**

```css
/* app.css */
@import "tailwindcss";

@theme {
  --color-brand-primary: #1DA1F2;
  --color-brand-secondary: #14171A;
  --font-sans: Inter, system-ui, sans-serif;
}

/* Add extra scan paths only when auto-detection is insufficient */
@source "../packages/ui/src/**/*.{ts,tsx}";
```

**Benefits for both versions**:
- Team uses consistent tokens
- No random values scattered in code
- Single source of truth for design updates

### 7. Dynamic Classes - CRITICAL PATTERN

**NEVER use string interpolation for class names**:

```jsx
// ❌ VERY BAD: Tailwind cannot detect these
<div className={`text-${color}-500`}>
<div className={`bg-${theme}-100 text-${theme}-900`}>

// ✅ GOOD: Complete class names
<div className={color === 'blue' ? 'text-blue-500' : 'text-red-500'}>

// ✅ BETTER: Object mapping
const colorClasses = {
  blue: 'text-blue-500 bg-blue-50',
  red: 'text-red-500 bg-red-50',
  green: 'text-green-500 bg-green-50',
};
<div className={colorClasses[color]}>

// ✅ BEST: Use a library like clsx or classnames
import clsx from 'clsx';

<div className={clsx(
  'px-4 py-2 rounded',
  isActive && 'bg-blue-500 text-white',
  isDisabled && 'opacity-50 cursor-not-allowed'
)}>
```

### 8. Style Variants Pattern

Define component variants explicitly rather than accepting arbitrary classes:

```jsx
// ❌ BAD: Arbitrary classes via props (override conflicts)
<Button className="bg-red-500" />

// ✅ GOOD: Predefined variants
const Button = ({ variant = 'primary', size = 'md', children }) => {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    ghost: 'bg-transparent hover:bg-gray-100 text-gray-700',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button className={`
      rounded-lg font-medium transition-colors
      ${variants[variant]}
      ${sizes[size]}
    `}>
      {children}
    </button>
  );
};
```

### 9. Accessibility Requirements

Tailwind doesn't handle accessibility automatically. You must:

```jsx
// ✅ Proper semantic HTML
<button
  className="bg-blue-500 text-white px-4 py-2 rounded"
  aria-label="Submit form"
  type="submit"
>
  Submit
</button>

// ✅ Color contrast (WCAG AA: 4.5:1 minimum)
// Use tools like https://webaim.org/resources/contrastchecker/
<div className="bg-gray-900 text-white"> // High contrast ✓
<div className="bg-gray-300 text-gray-400"> // Poor contrast ✗

// ✅ Focus states
<button className="
  bg-blue-500 hover:bg-blue-600
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
">

// ✅ Screen reader only content
<span className="sr-only">Skip to main content</span>
```

### 10. Performance Optimization

```javascript
// v3: ensure correct content paths (JIT relies on these)
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    // Add all paths where Tailwind classes exist in v3 projects
  ],
};

// v4: automatic source detection by default.
// Use @source when classes are generated outside default scan roots.
// In all cases, keep NODE_ENV=production for production builds.
```

### 11. Team Collaboration

```bash
# Install ESLint plugin
npm install -D eslint-plugin-tailwindcss
```

```json
// .eslintrc.json
{
  "extends": ["plugin:tailwindcss/recommended"],
  "rules": {
    "tailwindcss/classnames-order": "warn",
    "tailwindcss/no-custom-classname": "warn",
    "tailwindcss/no-contradicting-classname": "error"
  }
}
```

### 12. Common Tailwind Pitfalls

**Class Soup Problem**:
```jsx
// ❌ BAD: Unreadable
<div className="px-4 py-2 bg-blue-500 text-white rounded-md shadow-md hover:bg-blue-600 transition duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50">

// ✅ FIX: Extract to component
<PrimaryButton />
```

**Missing Accessibility**:
```jsx
// ❌ BAD
<div className="cursor-pointer" onClick={handleClick}>Click</div>

// ✅ GOOD
<button className="cursor-pointer" onClick={handleClick}>Click</button>
```

**Bundle Bloat**:
```javascript
// ❌ BAD: Empty or wrong content paths
module.exports = {
  content: [],  // Nothing gets scanned!
}

// ✅ GOOD
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
}
```

---

## Traditional CSS Best Practices

### 1. File Organization

```
styles/
├── base/
│   ├── reset.css          # CSS reset or normalize
│   ├── typography.css     # Font styles
│   └── variables.css      # CSS custom properties
├── components/
│   ├── buttons.css
│   ├── cards.css
│   └── forms.css
├── layouts/
│   ├── grid.css
│   ├── header.css
│   └── footer.css
├── utilities/
│   └── helpers.css        # Utility classes
└── main.css               # Main entry point
```

### 2. Naming Conventions

**BEM (Block Element Modifier)** - Recommended:

```css
/* Block */
.card {}

/* Element */
.card__header {}
.card__body {}
.card__footer {}

/* Modifier */
.card--featured {}
.card--compact {}
.card__header--large {}
```

**SMACSS Alternative**:

```css
/* Base */
body, h1, p {}

/* Layout */
.l-header {}
.l-sidebar {}
.l-main {}

/* Module/Component */
.card {}
.button {}

/* State */
.is-active {}
.is-hidden {}
.is-loading {}

/* Theme */
.theme-dark {}
.theme-light {}
```

### 3. Property Ordering (Concentric CSS)

```css
.element {
  /* Positioning */
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;

  /* Display & Box Model */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100vh;
  margin: 0 auto;
  padding: 20px;

  /* Borders */
  border: 1px solid #ddd;
  border-radius: 8px;

  /* Backgrounds */
  background-color: #fff;
  background-image: url('...');
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);

  /* Typography */
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  color: #333;
  text-align: center;

  /* Other */
  opacity: 1;
  cursor: pointer;
  transition: all 0.3s ease;
}
```

### 4. CSS Custom Properties (Variables)

```css
:root {
  /* Colors */
  --color-primary: #1DA1F2;
  --color-secondary: #14171A;
  --color-accent: #F91880;
  --color-background: #FFFFFF;
  --color-text: #0F1419;
  --color-text-secondary: #536471;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'Fira Code', monospace;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;

  /* Borders */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  :root {
    --color-background: #000000;
    --color-text: #E7E9EA;
    --color-text-secondary: #71767B;
  }
}

/* Usage */
.button {
  background-color: var(--color-primary);
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  box-shadow: var(--shadow-md);
}
```

### 5. Selector Best Practices

```css
/* ❌ BAD: Overly specific */
header nav ul li a.active {}

/* ✅ GOOD: Low specificity */
.nav-link.is-active {}

/* ❌ BAD: Nested too deep */
article.main .content .sidebar p.intro {}

/* ✅ GOOD: Flat and specific */
.sidebar-intro {}

/* ❌ BAD: Element + class (unnecessarily specific) */
div.card {}
p.description {}

/* ✅ GOOD: Class only */
.card {}
.description {}
```

**Specificity Tips**:
- Keep specificity as low as possible
- Prefer class selectors over ID selectors
- Avoid `!important` (except for utility classes)
- Use one class name per element when possible

### 6. Modern Layout Techniques

**Flexbox**:
```css
.flex-container {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.flex-item {
  flex: 1 1 300px; /* grow shrink basis */
}
```

**CSS Grid**:
```css
.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 24px;
}

/* Named grid areas */
.layout {
  display: grid;
  grid-template-areas:
    "header header header"
    "sidebar main main"
    "footer footer footer";
  grid-template-columns: 250px 1fr 1fr;
  gap: 20px;
}

.header { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main { grid-area: main; }
.footer { grid-area: footer; }
```

**Container Queries (2024)**:
```css
.container {
  container-type: inline-size;
  container-name: card;
}

@container card (min-width: 500px) {
  .card__content {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
```

### 7. Responsive Design

**Mobile-First Approach**:

```css
/* Base styles (mobile) */
.container {
  padding: 10px;
  font-size: 14px;
}

/* Tablet and up */
@media (min-width: 768px) {
  .container {
    padding: 20px;
    font-size: 16px;
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .container {
    padding: 30px;
    max-width: 1200px;
    margin: 0 auto;
  }
}

/* Large desktop */
@media (min-width: 1440px) {
  .container {
    padding: 40px;
    max-width: 1400px;
  }
}
```

**Common Breakpoints**:
```css
/* Mobile: 0-639px (default) */
/* Tablet: 640px-1023px */
@media (min-width: 640px) {}

/* Desktop: 1024px-1279px */
@media (min-width: 1024px) {}

/* Large: 1280px+ */
@media (min-width: 1280px) {}
```

### 8. Avoiding Code Repetition

```css
/* ❌ BAD: Repeated styles */
.button-primary {
  padding: 10px 20px;
  border-radius: 5px;
  font-weight: 600;
  background-color: blue;
}

.button-secondary {
  padding: 10px 20px;
  border-radius: 5px;
  font-weight: 600;
  background-color: gray;
}

/* ✅ GOOD: Use cascade */
.button {
  padding: 10px 20px;
  border-radius: 5px;
  font-weight: 600;
}

.button-primary {
  background-color: blue;
}

.button-secondary {
  background-color: gray;
}
```

### 9. CSS Reset/Normalize

```css
/* Modern CSS Reset */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  line-height: 1.5;
  font-family: system-ui, -apple-system, sans-serif;
}

img, picture, video, canvas, svg {
  display: block;
  max-width: 100%;
}

input, button, textarea, select {
  font: inherit;
}

p, h1, h2, h3, h4, h5, h6 {
  overflow-wrap: break-word;
}
```

Or use [normalize.css](https://necolas.github.io/normalize.css/):
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">
```

### 10. Comments and Documentation

```css
/**
 * Component: Card
 * Description: Reusable card component for content display
 * Last updated: 2024-01-15
 */
.card {
  /* ... */
}

/* Section: Header Styles */
.header {
  /* Fix for Safari flexbox bug */
  min-height: 0;
}

/**
 * Color scheme:
 * Primary: #1DA1F2
 * Secondary: #14171A
 * Accent: #F91880
 */
```

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
    body { margin: 0; font-family: sans-serif; }
    .header { background: #fff; height: 60px; }
    .hero { min-height: 100vh; }
  </style>

  <!-- Load remaining CSS asynchronously -->
  <link rel="preload" href="main.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="main.css"></noscript>
</head>
```

### 3. Avoid Expensive Properties

```css
/* ❌ EXPENSIVE: Triggers layout/paint */
.expensive {
  width: 100px;
  height: 100px;
  top: 100px;
  box-shadow: 0 0 5px rgba(0,0,0,0.3);
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
  plugins: [
    require('autoprefixer')
  ]
}
```

### 2. Feature Detection

```css
/* Modern feature with fallback */
.element {
  background-color: #1DA1F2; /* Fallback */
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

## Modern CSS Features

### 1. CSS Nesting

```css
/* Native CSS nesting (no preprocessor needed) */
.card {
  padding: 20px;

  & .card-header {
    font-size: 24px;
    font-weight: bold;
  }

  & .card-body {
    margin-top: 10px;
  }

  &:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }
}
```

### 2. :has() Selector

```css
/* Style parent based on child */
.card:has(.card-image) {
  display: grid;
  grid-template-columns: 200px 1fr;
}

/* Form validation */
.form-group:has(input:invalid) {
  border-color: red;
}
```

### 3. Subgrid

```css
.grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
}

.grid-item {
  display: grid;
  grid-template-columns: subgrid; /* Inherit parent grid */
}
```

---

## Quick Reference Checklist

### Before Writing Styles

- [ ] Does project need Tailwind? (design system + components?)
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
- [ ] Classes ordered properly (Prettier plugin installed)?
- [ ] Using shorthand utilities (mx, py)?
- [ ] Avoiding string interpolation for classes?
- [ ] Using predefined variants instead of arbitrary classes?
- [ ] Version-appropriate config strategy applied?
- [ ] v3: `content` paths complete? v4: `@source` added when required?
- [ ] ESLint plugin for Tailwind installed?

### Before Committing

- [ ] No unused utilities (v3: content/JIT, v4: auto-detection + optional `@source`)?
- [ ] Minified for production?
- [ ] Critical CSS inlined if needed?
- [ ] Accessibility tested (keyboard navigation, screen reader)?
- [ ] Responsive tested on multiple screen sizes?
- [ ] Cross-browser tested?

---

## Common Mistakes and Solutions

### Mistake 1: Fighting Specificity Wars
```css
/* ❌ BAD */
.button { color: blue; }
.button.primary { color: white !important; }
.header .button { color: red !important; }

/* ✅ GOOD */
.button { color: blue; }
.button--primary { color: white; }
.header-button { color: red; }
```

### Mistake 2: Not Using Variables
```css
/* ❌ BAD */
.header { background: #1DA1F2; }
.button { background: #1DA1F2; }
.link { color: #1DA1F2; }

/* ✅ GOOD */
:root { --color-primary: #1DA1F2; }
.header { background: var(--color-primary); }
.button { background: var(--color-primary); }
.link { color: var(--color-primary); }
```

### Mistake 3: Ignoring Mobile
```css
/* ❌ BAD: Desktop-first */
.container { width: 1200px; padding: 40px; }
@media (max-width: 768px) { .container { width: 100%; padding: 20px; } }

/* ✅ GOOD: Mobile-first */
.container { width: 100%; padding: 20px; }
@media (min-width: 768px) { .container { width: 1200px; padding: 40px; } }
```

### Mistake 4: Over-Nesting
```css
/* ❌ BAD */
.nav ul li a span.icon { /* ... */ }

/* ✅ GOOD */
.nav-icon { /* ... */ }
```

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

## Output Format

When providing CSS/Tailwind guidance:

1. **Identify the context**: What framework/approach is being used?
2. **Run version detection protocol**: Dependency first, then syntax/config cross-check
3. **Output required fields**:
   - `Detected Version`: `v3` | `v4` | `conflict` | `unknown`
   - `Evidence`: dependency + syntax/config evidence you used
   - `Primary Path`: the main recommendation for detected version
   - `Alternate Path`: compatible fallback path for the other version
   - `Conflict Fix`: required when state is `conflict` (include two repair options + recommended option)
4. **Provide specific code examples**: Show good vs bad patterns
5. **Explain the reasoning**: Why one approach is better
6. **Consider accessibility**: Always mention a11y implications
7. **Check performance**: Flag potential performance issues
8. **Suggest tools**: Recommend automation where possible

Always prioritize:
- ✅ Maintainability and readability
- ✅ Performance and bundle size
- ✅ Accessibility compliance
- ✅ Team consistency
- ✅ Modern best practices

---

## Version History

- **v1.2** (2026-02-24): Added v3/v4 dual-track support with dependency-first detection flow, conflict handling, and structured output contract fields.
- **v1.1** (2026-02-24): Clarified Tailwind adoption criteria, responsive prefix guidance, and compatibility wording.
- **v1.0** (2025-01): Initial release covering Tailwind CSS + modern CSS best practices.
