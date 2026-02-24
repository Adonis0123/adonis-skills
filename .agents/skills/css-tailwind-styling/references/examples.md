# Code Examples and Patterns

This file contains additional code examples and common patterns for CSS and Tailwind CSS development.

## Component Library Patterns

### Button Component Variants

```jsx
// components/Button.jsx
import { cva, cx } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
        secondary: 'bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500',
        danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
        ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
        outline: 'border-2 border-gray-300 bg-transparent hover:bg-gray-50 focus:ring-gray-500',
      },
      size: {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-base',
        lg: 'px-6 py-3 text-lg',
        xl: 'px-8 py-4 text-xl',
      },
      disabled: {
        true: 'opacity-50 cursor-not-allowed pointer-events-none',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export function Button({ variant, size, disabled, className, children, ...props }) {
  return (
    <button
      className={cx(buttonVariants({ variant, size, disabled }), className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
```

### Card Component with Composition

```jsx
// components/Card.jsx
const Card = ({ children, className = '' }) => (
  <div className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>
    {children}
  </div>
);

const CardHeader = ({ children, className = '' }) => (
  <div className={`border-b border-gray-200 px-6 py-4 ${className}`}>
    {children}
  </div>
);

const CardBody = ({ children, className = '' }) => (
  <div className={`px-6 py-4 ${className}`}>
    {children}
  </div>
);

const CardFooter = ({ children, className = '' }) => (
  <div className={`border-t border-gray-200 px-6 py-4 ${className}`}>
    {children}
  </div>
);

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export { Card };

// Usage
<Card>
  <Card.Header>
    <h2 className="text-xl font-semibold">Card Title</h2>
  </Card.Header>
  <Card.Body>
    <p>Card content goes here...</p>
  </Card.Body>
  <Card.Footer>
    <Button>Action</Button>
  </Card.Footer>
</Card>
```

## Layout Patterns

### Responsive Dashboard Grid

```jsx
function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <nav>Logo & Navigation</nav>
            <div>User Menu</div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.id}>
              <Card.Body>
                <p className="text-sm text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bold">{stat.value}</p>
              </Card.Body>
            </Card>
          ))}
        </div>

        {/* Main Grid */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Large Section */}
          <div className="lg:col-span-2">
            <Card>
              <Card.Header>Main Content</Card.Header>
              <Card.Body>{/* Content */}</Card.Body>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <Card.Header>Sidebar Item 1</Card.Header>
              <Card.Body>{/* Content */}</Card.Body>
            </Card>
            <Card>
              <Card.Header>Sidebar Item 2</Card.Header>
              <Card.Body>{/* Content */}</Card.Body>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
```

### Sidebar Layout with Responsive Toggle

```jsx
function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between px-4">
            <h1 className="text-xl font-bold">Logo</h1>
            <button
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              ✕
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-2 py-4">
            {/* Navigation items */}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center border-b border-gray-200 bg-white px-4">
          <button
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <h2 className="ml-4 text-xl font-semibold lg:ml-0">Page Title</h2>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
```

## Form Patterns

### Accessible Form with Validation

```jsx
function ContactForm() {
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  return (
    <form className="mx-auto max-w-lg space-y-6">
      {/* Text Input */}
      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-gray-700"
        >
          Name
          <span className="text-red-500" aria-label="required">*</span>
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          aria-required="true"
          aria-invalid={errors.name ? 'true' : 'false'}
          aria-describedby={errors.name ? 'name-error' : undefined}
          className={`
            mt-1 block w-full rounded-md border px-3 py-2 shadow-sm
            focus:outline-none focus:ring-2 focus:ring-offset-2
            ${errors.name && touched.name
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
            }
          `}
          onBlur={() => setTouched({ ...touched, name: true })}
        />
        {errors.name && touched.name && (
          <p id="name-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      {/* Select */}
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700">
          Category
        </label>
        <select
          id="category"
          name="category"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <option value="">Select a category</option>
          <option value="general">General Inquiry</option>
          <option value="support">Support</option>
          <option value="sales">Sales</option>
        </select>
      </div>

      {/* Textarea */}
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-gray-700">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        />
      </div>

      {/* Checkbox */}
      <div className="flex items-start">
        <input
          type="checkbox"
          id="newsletter"
          name="newsletter"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        />
        <label htmlFor="newsletter" className="ml-2 block text-sm text-gray-700">
          Subscribe to newsletter
        </label>
      </div>

      {/* Submit Button */}
      <Button type="submit" className="w-full">
        Send Message
      </Button>
    </form>
  );
}
```

## Animation Patterns

### Smooth Transitions

```jsx
// Fade in on mount
function FadeIn({ children, delay = 0 }) {
  return (
    <div
      className="animate-fade-in opacity-0"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
      {children}
    </div>
  );
}

// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        'slide-in': 'slide-in 0.3s ease-out',
      },
    },
  },
};
```

### Loading Skeleton

```jsx
function Skeleton({ className = '' }) {
  return (
    <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} />
  );
}

function CardSkeleton() {
  return (
    <Card>
      <Card.Body className="space-y-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </Card.Body>
    </Card>
  );
}
```

## Dark Mode Patterns

### Complete Dark Mode Setup

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class', // or 'media' for system preference
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          // ... light mode colors
          900: '#1e3a8a',
          950: '#172554', // extra dark for dark mode
        },
      },
    },
  },
};
```

```jsx
// Dark mode toggle component
function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = stored === 'dark' || (!stored && prefersDark);

    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    document.documentElement.classList.toggle('dark', newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  return (
    <button
      onClick={toggleTheme}
      className="rounded-lg bg-gray-200 p-2 dark:bg-gray-700"
      aria-label="Toggle theme"
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
```

```jsx
// Component with dark mode styles
function Card({ children }) {
  return (
    <div className="
      rounded-lg border bg-white shadow-sm
      dark:border-gray-700 dark:bg-gray-800
    ">
      {children}
    </div>
  );
}
```

## Performance Optimization Patterns

### Code Splitting with Dynamic Imports

```jsx
import { lazy, Suspense } from 'react';

const HeavyComponent = lazy(() => import('./HeavyComponent'));

function App() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <HeavyComponent />
    </Suspense>
  );
}
```

### Optimized Tailwind Config

```javascript
// v3: tailwind.config.js
module.exports = {
  // Only scan necessary files
  content: [
    './src/pages/**/*.{js,jsx,ts,tsx}',
    './src/components/**/*.{js,jsx,ts,tsx}',
    './src/layouts/**/*.{js,jsx,ts,tsx}',
  ],

  // Safelist classes that are generated dynamically
  // Keep literal classes and pattern-based rules in one array.
  safelist: [
    'bg-red-500',
    'bg-green-500',
    'bg-blue-500',
    {
      pattern: /bg-(red|green|blue)-(400|500|600)/,
    },
  ],
};
```

```css
/* v4: app.css (CSS-first) */
@import "tailwindcss";

@theme {
  --color-brand-primary: #1d4ed8;
  --color-brand-secondary: #0f172a;
}

/* Add when classes live outside default scan roots */
@source "../packages/ui/src/**/*.{ts,tsx}";
```

## Utility Class Patterns

### Custom Utility Plugin

```javascript
// tailwind.config.js
const plugin = require('tailwindcss/plugin');

module.exports = {
  plugins: [
    plugin(function({ addUtilities }) {
      addUtilities({
        '.text-balance': {
          'text-wrap': 'balance',
        },
        '.scrollbar-hide': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
        },
        '.content-auto': {
          'content-visibility': 'auto',
        },
      });
    }),
  ],
};
```

This examples file complements the main SKILL.md with practical implementations and real-world patterns.
