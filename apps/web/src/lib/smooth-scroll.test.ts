import { describe, expect, it, vi } from "vitest";
import {
  HEADER_GAP,
  computeScrollDuration,
  computeTargetY,
  createSmoothScroller,
  getSamePageHash,
  parseCssLength,
  resolveHeaderOffset,
  resolveTargetOffset,
  type ScrollAnimateFn,
  type ScrollEnv,
} from "./smooth-scroll";

function fakeEnv(overrides: Partial<ScrollEnv> = {}) {
  let scrollY = 0;
  const frames: number[] = [];
  const stop = vi.fn();
  let interrupt: (() => void) | null = null;
  const removeListeners = vi.fn();
  let lastAnimation: Parameters<ScrollAnimateFn> | null = null;

  const env: ScrollEnv = {
    getScrollY: () => scrollY,
    getMaxScrollY: () => 5000,
    scrollTo: (y) => {
      scrollY = y;
      frames.push(y);
    },
    prefersReducedMotion: () => false,
    onUserInterrupt: (cancel) => {
      interrupt = cancel;
      return removeListeners;
    },
    animate: vi.fn<ScrollAnimateFn>((...args) => {
      lastAnimation = args;
      return { stop };
    }),
    ...overrides,
  };

  return {
    env,
    frames,
    stop,
    removeListeners,
    interrupt: () => interrupt?.(),
    /** Drives the captured animation: emits frames, then completes. */
    play: (...values: number[]) => {
      if (!lastAnimation) throw new Error("animate was not called");
      for (const v of values) lastAnimation[2].onUpdate(v);
      lastAnimation[2].onComplete();
    },
    lastOptions: () => lastAnimation?.[2],
  };
}

describe("computeTargetY", () => {
  it("keeps the target `offset` px below the viewport top", () => {
    expect(
      computeTargetY({
        elementTop: 900,
        scrollY: 200,
        offset: 88,
        maxScrollY: 5000,
      }),
    ).toBe(1012);
  });

  it("clamps to the top and to the max scroll", () => {
    expect(
      computeTargetY({
        elementTop: 20,
        scrollY: 0,
        offset: 88,
        maxScrollY: 5000,
      }),
    ).toBe(0);
    expect(
      computeTargetY({
        elementTop: 4000,
        scrollY: 3000,
        offset: 88,
        maxScrollY: 5000,
      }),
    ).toBe(5000);
  });
});

describe("computeScrollDuration", () => {
  it("is 0 for no movement", () => {
    expect(computeScrollDuration(0)).toBe(0);
    expect(computeScrollDuration(0.4)).toBe(0);
  });

  it("grows with distance in either direction", () => {
    const short = computeScrollDuration(100);
    const mid = computeScrollDuration(1000);
    expect(short).toBeGreaterThanOrEqual(0.28);
    expect(mid).toBeGreaterThan(short);
    expect(computeScrollDuration(-1000)).toBe(mid);
  });

  it("caps long scrolls at 0.9s", () => {
    expect(computeScrollDuration(20000)).toBe(0.9);
  });
});

describe("parseCssLength", () => {
  it("reads px, rem and unitless values", () => {
    expect(parseCssLength("64px")).toBe(64);
    expect(parseCssLength(" 5.5rem ", 16)).toBe(88);
    expect(parseCssLength("72")).toBe(72);
  });

  it("returns null for empty or unsupported values", () => {
    expect(parseCssLength("")).toBeNull();
    expect(parseCssLength("auto")).toBeNull();
    expect(parseCssLength("calc(1rem + 2px)")).toBeNull();
  });
});

describe("resolveHeaderOffset", () => {
  function fakeDoc({
    headerVar = "",
    header,
    scrollPaddingTop = "auto",
  }: {
    headerVar?: string;
    header?: { selector: string; height: number };
    scrollPaddingTop?: string;
  }) {
    return {
      documentElement: {},
      defaultView: {
        getComputedStyle: () => ({
          fontSize: "16px",
          scrollPaddingTop,
          getPropertyValue: (name: string) =>
            name === "--header-height" ? headerVar : "",
        }),
      },
      querySelector: (selector: string) =>
        header?.selector === selector
          ? { getBoundingClientRect: () => ({ height: header.height }) }
          : null,
    } as unknown as Document;
  }

  it("prefers the --header-height CSS var", () => {
    const doc = fakeDoc({
      headerVar: "4rem",
      header: { selector: "header.sticky", height: 999 },
    });
    expect(resolveHeaderOffset(doc)).toBe(64 + HEADER_GAP);
  });

  it("measures [data-site-header] before header.sticky", () => {
    expect(
      resolveHeaderOffset(
        fakeDoc({ header: { selector: "[data-site-header]", height: 70 } }),
      ),
    ).toBe(70 + HEADER_GAP);
    expect(
      resolveHeaderOffset(
        fakeDoc({ header: { selector: "header.sticky", height: 60 } }),
      ),
    ).toBe(60 + HEADER_GAP);
  });

  it("falls back to scroll-padding-top, then 0", () => {
    expect(resolveHeaderOffset(fakeDoc({ scrollPaddingTop: "88px" }))).toBe(88);
    expect(resolveHeaderOffset(fakeDoc({}))).toBe(0);
  });
});

describe("resolveTargetOffset", () => {
  it("keeps the header offset unless the target asks for more room", () => {
    expect(resolveTargetOffset(88, 0)).toBe(88);
    expect(resolveTargetOffset(88, 96)).toBe(96);
    expect(resolveTargetOffset(88, Number.NaN)).toBe(88);
  });
});

describe("createSmoothScroller", () => {
  it("animates from the current position with a distance-scaled duration", async () => {
    const t = fakeEnv();
    const { scrollToY } = createSmoothScroller(() => t.env);

    const done = scrollToY(1200);
    expect(t.env.animate).toHaveBeenCalledWith(0, 1200, expect.any(Object));
    expect(t.lastOptions()?.duration).toBe(computeScrollDuration(1200));

    t.play(400, 900, 1200);
    await expect(done).resolves.toBe(true);
    expect(t.frames).toEqual([400, 900, 1200]);
    expect(t.removeListeners).toHaveBeenCalledOnce();
  });

  it("jumps instantly when the user prefers reduced motion", async () => {
    const t = fakeEnv({ prefersReducedMotion: () => true });
    const { scrollToY } = createSmoothScroller(() => t.env);

    await expect(scrollToY(1200)).resolves.toBe(true);
    expect(t.env.animate).not.toHaveBeenCalled();
    expect(t.frames).toEqual([1200]);
  });

  it("clamps the target to the scrollable range", async () => {
    const t = fakeEnv({ prefersReducedMotion: () => true });
    const { scrollToY } = createSmoothScroller(() => t.env);

    await scrollToY(99999);
    await scrollToY(-50);
    expect(t.frames).toEqual([5000, 0]);
  });

  it("stops and resolves false when the user wheels, touches or presses a key", async () => {
    const t = fakeEnv();
    const { scrollToY } = createSmoothScroller(() => t.env);

    const done = scrollToY(2000);
    t.interrupt();
    await expect(done).resolves.toBe(false);
    expect(t.stop).toHaveBeenCalledOnce();
    expect(t.removeListeners).toHaveBeenCalledOnce();
  });

  it("cancels the running scroll when a new one starts", async () => {
    const t = fakeEnv();
    const { scrollToY } = createSmoothScroller(() => t.env);

    const first = scrollToY(2000);
    const second = scrollToY(300);
    await expect(first).resolves.toBe(false);
    expect(t.stop).toHaveBeenCalledOnce();

    t.play(300);
    await expect(second).resolves.toBe(true);
  });
});

describe("getSamePageHash", () => {
  const location = { href: "https://skills.example/en?q=git#old" };
  const plainClick = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };

  function anchor(attrs: Record<string, string>) {
    return {
      getAttribute: (name: string) => attrs[name] ?? null,
      hasAttribute: (name: string) => name in attrs,
    } as unknown as HTMLAnchorElement;
  }

  it("returns the hash for same-page links", () => {
    expect(
      getSamePageHash(anchor({ href: "#skills" }), plainClick, location),
    ).toBe("#skills");
    expect(
      getSamePageHash(
        anchor({ href: "/en?q=git#skills" }),
        plainClick,
        location,
      ),
    ).toBe("#skills");
    expect(getSamePageHash(anchor({ href: "#" }), plainClick, location)).toBe(
      "#",
    );
  });

  it("ignores links to other pages, origins or query strings", () => {
    expect(
      getSamePageHash(anchor({ href: "/zh#skills" }), plainClick, location),
    ).toBeNull();
    expect(
      getSamePageHash(anchor({ href: "/en#skills" }), plainClick, location),
    ).toBeNull();
    expect(
      getSamePageHash(
        anchor({ href: "https://other.example/en?q=git#skills" }),
        plainClick,
        location,
      ),
    ).toBeNull();
    expect(
      getSamePageHash(anchor({ href: "/en?q=git" }), plainClick, location),
    ).toBeNull();
  });

  it("leaves modified clicks, new tabs, downloads and opt-outs to the browser", () => {
    const link = anchor({ href: "#skills" });
    expect(
      getSamePageHash(link, { ...plainClick, metaKey: true }, location),
    ).toBeNull();
    expect(
      getSamePageHash(link, { ...plainClick, button: 1 }, location),
    ).toBeNull();
    expect(
      getSamePageHash(
        link,
        { ...plainClick, defaultPrevented: true },
        location,
      ),
    ).toBeNull();
    expect(
      getSamePageHash(
        anchor({ href: "#a", target: "_blank" }),
        plainClick,
        location,
      ),
    ).toBeNull();
    expect(
      getSamePageHash(
        anchor({ href: "#a", download: "" }),
        plainClick,
        location,
      ),
    ).toBeNull();
    expect(
      getSamePageHash(
        anchor({ href: "#a", "data-no-smooth-scroll": "" }),
        plainClick,
        location,
      ),
    ).toBeNull();
  });
});
