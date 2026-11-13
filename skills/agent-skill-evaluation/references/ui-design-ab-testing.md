# UI Design A/B Testing

Use this reference when the compared skills generate browser UI.

## Fairness Contract

Keep these identical across candidates:

- audience and primary user job
- page content, item counts, destinations, and factual claims
- implementation stack and dependency budget
- desktop/mobile breakpoints
- required interactions
- review rubric

Keep these isolated:

- tokens, CSS, component structure, motion, and typography
- design-system output and candidate-specific notes
- candidate logs or memory files

A neutral directory shape:

```text
/tmp/<trial>/
  brief.md
  candidate-a/{design-notes.md,index.html,styles.css,script.js}
  candidate-b/{design-notes.md,index.html,styles.css,script.js}
  screenshots/
  review-brief.md
  comparison.md
```

## Static Probe

For each artifact, verify at minimum:

1. expected content and category counts
2. external links and safe `target="_blank"` usage
3. one `h1`, then sequential section headings
4. viewport meta
5. visible `:focus-visible`
6. `prefers-reduced-motion`
7. no `transition: all`
8. filter/search script syntax and behavior
9. no invented metrics, testimonials, or proof
10. both `html` and `body` guard horizontal overflow when the design requires it

Static CSS guards do not prove fit. Continue with runtime geometry.

## True Mobile Viewport Probe

`Google Chrome --headless --window-size=375,812` may still use a larger minimum layout viewport. Its screenshot can appear horizontally clipped even when the page is correct. Do not score mobile quality from that screenshot alone.

Use Chrome DevTools Protocol (CDP) device emulation:

1. Launch a temporary headless Chrome with `--remote-debugging-port=<port>` and a disposable `--user-data-dir`.
2. Create a target through `PUT /json/new?about%3Ablank`.
3. Connect to the target's `webSocketDebuggerUrl`.
4. Call:

```json
{
  "method": "Emulation.setDeviceMetricsOverride",
  "params": {
    "width": 375,
    "height": 812,
    "deviceScaleFactor": 1,
    "mobile": true,
    "screenWidth": 375,
    "screenHeight": 812
  }
}
```

5. Enable touch emulation and navigate to the local page.
6. Evaluate runtime geometry:

```js
(() => {
  const overflow = [...document.querySelectorAll("*")]
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.right > innerWidth + 1 || rect.left < -1;
    })
    .map((el) => ({
      tag: el.tagName,
      className: el.className,
      text: (el.textContent || "").trim().slice(0, 40),
      rect: el.getBoundingClientRect().toJSON(),
    }));

  const shortTargets = [...document.querySelectorAll("a,button,input")]
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      return visible && (rect.width < 44 || rect.height < 44);
    })
    .map((el) => ({
      tag: el.tagName,
      text: (el.textContent || el.getAttribute("aria-label") || "")
        .trim()
        .slice(0, 30),
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));

  return {
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    overflow,
    shortTargets,
  };
})();
```

7. Capture the screenshot through `Page.captureScreenshot` after emulation.
8. Pass only when `innerWidth === scrollWidth`, `overflow` is empty, and every visible primary interaction is at least 44×44px.

Ignore hidden dialog controls whose bounding box is 0×0; they are not active touch targets in the current state. Open the dialog and probe again when that interaction is part of the brief.

### Runtime-probe correctness

Keep the verifier as strict as the product requirement, but do not confuse a broad assertion with a page defect:

- Determine visibility with `el.getClientRects().length > 0` plus computed `display` / `visibility`; checking only the child's `display` can count descendants of a hidden ancestor.
- Measure the actual interactive node. A 44px wrapper does not make a 42px `<input>` pass.
- When enabling touch emulation, send `maxTouchPoints` between 1 and 16. When disabling it, omit `maxTouchPoints` instead of sending `0`.
- Scope structural lint to the component under test. A raw substring search across the whole stylesheet can flag an unrelated grid as the target component.
- When a check fails, inspect runtime evidence and the assertion independently. Fix an over-broad checker only when the page demonstrably satisfies the original requirement; never weaken the requirement to make the run green.
- After any CSS correction, rerun static checks, every viewport, interactions, console capture, and screenshots. A visual fix can regress geometry or a candidate-specific quality gate.

## Visual Review

Inspect both 1280×800 and 375×812 at minimum:

- full first-screen composition
- headline wrapping and orphaned characters/words
- duplicated information before the content begins
- alignment, rhythm, and surface consistency
- whether decorative/status bands consume scarce mobile height
- whether filters remain readable and tappable

A geometry pass can coexist with an ugly wrap. Fix objective typography breakage before blind review.

## Blind Review Prompt Shape

Ask the reviewer to:

- score each candidate on the shared rubric
- list two strengths and two weaknesses per candidate
- choose one for the recurring daily task
- avoid editing files or guessing the skill mapping

If an objective bug is fixed after review, preserve the same reviewer session and ask only for the affected score plus the final choice. This reduces review drift.

## Reporting Intervention Cost

Report separately:

- first recommendation fit
- number and kind of retries
- manual constraint overrides
- objective bug fixes
- final artifact score

A candidate can win visually while losing on reliability. Make that trade-off visible before installation.
