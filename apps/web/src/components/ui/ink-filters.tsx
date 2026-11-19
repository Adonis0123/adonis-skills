/**
 * SVG filters that make ink outlines waver like a brush line (DESIGN.md
 * "ink-outline"). Referenced from custom.css as `filter: url(#ink-wobble)`
 * on the outline pseudo-elements only, never on text. Rendered once in the
 * root layout; the noise is static (no animation).
 */
export function InkFilters() {
  return (
    <svg
      aria-hidden
      focusable="false"
      width="0"
      height="0"
      className="pointer-events-none absolute"
    >
      <defs>
        {/* Panels, cards, the search bar. */}
        <filter id="ink-wobble" x="-4%" y="-12%" width="108%" height="136%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.022"
            numOctaves="2"
            seed="3"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/* Buttons, chips and other small pills: a tighter, smaller waver. */}
        <filter id="ink-wobble-sm" x="-6%" y="-30%" width="112%" height="180%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.04"
            numOctaves="2"
            seed="11"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2.2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
