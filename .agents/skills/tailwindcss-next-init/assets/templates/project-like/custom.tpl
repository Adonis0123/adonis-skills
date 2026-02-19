@reference "./tailwind-core.css";

:root {
	--safe-area-top: env(safe-area-inset-top, 0px);
	--safe-area-bottom: env(safe-area-inset-bottom, 0px);
}

@layer base {
	html,
	body {
		/* Disable elastic scrolling in Safari/iOS contexts */
		overscroll-behavior-y: none;
	}
}

@layer utilities {
	.safe-area-top {
		padding-top: var(--safe-area-top);
	}

	.safe-area-bottom {
		padding-bottom: var(--safe-area-bottom);
	}
}

@media (prefers-reduced-motion: reduce) {
	html:focus-within {
		scroll-behavior: auto;
	}

	*,
	*::before,
	*::after {
		animation-duration: 0.01ms;
		animation-iteration-count: 1;
		scroll-behavior: auto;
		transition-duration: 0.01ms;
	}
}
