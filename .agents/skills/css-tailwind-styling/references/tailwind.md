# Tailwind Detail

Read only the sections selected by [the skill entry](../SKILL.md). These detailed recipes remain subject to the requested scope, established version, and existing project conventions.

## Contents

- [Tailwind CSS Best Practices](#tailwind-css-best-practices)
  - [1. Prerequisites for Tailwind Projects](#1-prerequisites-for-tailwind-projects)
  - [2. Class Ordering and Organization](#2-class-ordering-and-organization)
  - [3. Minimize Utility Classes](#3-minimize-utility-classes)
  - [4. Responsive Design Prefixes](#4-responsive-design-prefixes)
  - [5. Component Abstraction Strategy](#5-component-abstraction-strategy)
  - [6. Tailwind Configuration (v3/v4)](#6-tailwind-configuration-v3v4)
  - [7. Dynamic Classes - CRITICAL PATTERN](#7-dynamic-classes---critical-pattern)
  - [8. Style Variants Pattern](#8-style-variants-pattern)
  - [9. Accessibility Requirements](#9-accessibility-requirements)
  - [10. Performance Optimization](#10-performance-optimization)
  - [11. Team Collaboration](#11-team-collaboration)
  - [12. Common Tailwind Pitfalls](#12-common-tailwind-pitfalls)

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

Follow the existing formatter and class ordering convention. If none is established, the **Concentric CSS** grouping below is one readable option:

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

**Automation**: Reuse the project formatter. Consider the [Prettier Plugin for Tailwind CSS](https://github.com/tailwindlabs/prettier-plugin-tailwindcss) for a requested tooling setup or a demonstrated formatting gap; it is not a prerequisite for a style fix. Adapt setup examples to the existing package manager and configuration:

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
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#1DA1F2",
          secondary: "#14171A",
          accent: "#1DA1F2",
        },
      },
      spacing: {
        128: "32rem",
        144: "36rem",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["Fira Code", "monospace"],
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
  --color-brand-primary: #1da1f2;
  --color-brand-secondary: #14171a;
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
<Button className="bg-red-500" />;

// ✅ GOOD: Predefined variants
const Button = ({ variant = "primary", size = "md", children }) => {
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-gray-600 hover:bg-gray-700 text-white",
    danger: "bg-red-600 hover:bg-red-700 text-white",
    ghost: "bg-transparent hover:bg-gray-100 text-gray-700",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  return (
    <button
      className={`
      rounded-lg font-medium transition-colors
      ${variants[variant]}
      ${sizes[size]}
    `}
    >
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
    "./src/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    // Add all paths where Tailwind classes exist in v3 projects
  ],
};

// v4: automatic source detection by default.
// Use @source when classes are generated outside default scan roots.
// In all cases, keep NODE_ENV=production for production builds.
```

### 11. Team Collaboration

For a requested lint setup or an identified lint gap, consider a compatible Tailwind plugin. Preserve the existing linter version and configuration style; the example below is not an instruction to add a second configuration to an established project.

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
  content: [], // Nothing gets scanned!
};

// ✅ GOOD
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
};
```

---
