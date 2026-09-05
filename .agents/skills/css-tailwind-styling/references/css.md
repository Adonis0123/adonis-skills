# CSS Detail

Read only the sections selected by [the skill entry](../SKILL.md). These detailed recipes remain subject to the requested scope, established version, and existing project conventions.

## Contents

- [Traditional CSS Best Practices](#traditional-css-best-practices)
  - [1. File Organization](#1-file-organization)
  - [2. Naming Conventions](#2-naming-conventions)
  - [3. Property Ordering (Concentric CSS)](#3-property-ordering-concentric-css)
  - [4. CSS Custom Properties (Variables)](#4-css-custom-properties-variables)
  - [5. Selector Best Practices](#5-selector-best-practices)
  - [6. Modern Layout Techniques](#6-modern-layout-techniques)
  - [7. Responsive Design](#7-responsive-design)
  - [8. Avoiding Code Repetition](#8-avoiding-code-repetition)
  - [9. CSS Reset/Normalize](#9-css-resetnormalize)
  - [10. Comments and Documentation](#10-comments-and-documentation)
- [Modern CSS Features](#modern-css-features)
  - [1. CSS Nesting](#1-css-nesting)
  - [2. :has() Selector](#2-has-selector)
  - [3. Subgrid](#3-subgrid)
- [Common Mistakes and Solutions](#common-mistakes-and-solutions)
  - [Mistake 1: Fighting Specificity Wars](#mistake-1-fighting-specificity-wars)
  - [Mistake 2: Not Using Variables](#mistake-2-not-using-variables)
  - [Mistake 3: Ignoring Mobile](#mistake-3-ignoring-mobile)
  - [Mistake 4: Over-Nesting](#mistake-4-over-nesting)

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
.card {
}

/* Element */
.card__header {
}
.card__body {
}
.card__footer {
}

/* Modifier */
.card--featured {
}
.card--compact {
}
.card__header--large {
}
```

**SMACSS Alternative**:

```css
/* Base */
body,
h1,
p {
}

/* Layout */
.l-header {
}
.l-sidebar {
}
.l-main {
}

/* Module/Component */
.card {
}
.button {
}

/* State */
.is-active {
}
.is-hidden {
}
.is-loading {
}

/* Theme */
.theme-dark {
}
.theme-light {
}
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
  background-image: url("...");
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  /* Typography */
  font-family: "Inter", sans-serif;
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
  --color-primary: #1da1f2;
  --color-secondary: #14171a;
  --color-accent: #f91880;
  --color-background: #ffffff;
  --color-text: #0f1419;
  --color-text-secondary: #536471;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Typography */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "Fira Code", monospace;
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
    --color-text: #e7e9ea;
    --color-text-secondary: #71767b;
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
header nav ul li a.active {
}

/* ✅ GOOD: Low specificity */
.nav-link.is-active {
}

/* ❌ BAD: Nested too deep */
article.main .content .sidebar p.intro {
}

/* ✅ GOOD: Flat and specific */
.sidebar-intro {
}

/* ❌ BAD: Element + class (unnecessarily specific) */
div.card {
}
p.description {
}

/* ✅ GOOD: Class only */
.card {
}
.description {
}
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

.header {
  grid-area: header;
}
.sidebar {
  grid-area: sidebar;
}
.main {
  grid-area: main;
}
.footer {
  grid-area: footer;
}
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
@media (min-width: 640px) {
}

/* Desktop: 1024px-1279px */
@media (min-width: 1024px) {
}

/* Large: 1280px+ */
@media (min-width: 1280px) {
}
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
*,
*::before,
*::after {
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
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

img,
picture,
video,
canvas,
svg {
  display: block;
  max-width: 100%;
}

input,
button,
textarea,
select {
  font: inherit;
}

p,
h1,
h2,
h3,
h4,
h5,
h6 {
  overflow-wrap: break-word;
}
```

Or use [normalize.css](https://necolas.github.io/normalize.css/):

```html
<link
  rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css"
/>
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
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
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

## Common Mistakes and Solutions

### Mistake 1: Fighting Specificity Wars

```css
/* ❌ BAD */
.button {
  color: blue;
}
.button.primary {
  color: white !important;
}
.header .button {
  color: red !important;
}

/* ✅ GOOD */
.button {
  color: blue;
}
.button--primary {
  color: white;
}
.header-button {
  color: red;
}
```

### Mistake 2: Not Using Variables

```css
/* ❌ BAD */
.header {
  background: #1da1f2;
}
.button {
  background: #1da1f2;
}
.link {
  color: #1da1f2;
}

/* ✅ GOOD */
:root {
  --color-primary: #1da1f2;
}
.header {
  background: var(--color-primary);
}
.button {
  background: var(--color-primary);
}
.link {
  color: var(--color-primary);
}
```

### Mistake 3: Ignoring Mobile

```css
/* ❌ BAD: Desktop-first */
.container {
  width: 1200px;
  padding: 40px;
}
@media (max-width: 768px) {
  .container {
    width: 100%;
    padding: 20px;
  }
}

/* ✅ GOOD: Mobile-first */
.container {
  width: 100%;
  padding: 20px;
}
@media (min-width: 768px) {
  .container {
    width: 1200px;
    padding: 40px;
  }
}
```

### Mistake 4: Over-Nesting

```css
/* ❌ BAD */
.nav ul li a span.icon {
  /* ... */
}

/* ✅ GOOD */
.nav-icon {
  /* ... */
}
```

---
