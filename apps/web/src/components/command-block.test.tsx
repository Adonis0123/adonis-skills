import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandBlock, CopyTextBlock } from "./command-block";
import { clickCopyTarget } from "./copy-install-command";
import { InstallTabs } from "./host-install-tabs";
import { useCopyTarget } from "./motion/use-copy-target";

// The Lingui macro is compiled away by SWC in Next; vitest runs uncompiled source.
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: () => "" }),
  Trans: () => null,
}));

/** A tiny element tree: enough of `closest` / `contains` for the copy-box guard. */
interface FakeNode {
  tag: string;
  attrs: Record<string, string>;
  parent: FakeNode | null;
  closest: (selectors: string) => FakeNode | null;
  contains: (node: unknown) => boolean;
}

function matches(node: FakeNode, selector: string) {
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attr)
    return attr[2] === undefined
      ? attr[1] in node.attrs
      : node.attrs[attr[1]] === attr[2];
  return node.tag === selector;
}

function el(
  tag: string,
  attrs: Record<string, string> = {},
  parent: FakeNode | null = null,
): FakeNode {
  const node: FakeNode = {
    tag,
    attrs,
    parent,
    closest: (selectors) => {
      const list = selectors.split(",").map((s) => s.trim());
      for (let n: FakeNode | null = node; n; n = n.parent)
        if (list.some((s) => matches(n as FakeNode, s))) return n;
      return null;
    },
    contains: (other) => {
      for (let n = other as FakeNode | null; n; n = n.parent)
        if (n === node) return true;
      return false;
    },
  };
  return node;
}

/** Runs the hook once through the server renderer and returns its props. */
type CopyTargetProps = ReturnType<typeof useCopyTarget>;

function Harness({
  onCopy,
  onProps,
}: {
  onCopy: () => void;
  onProps: (props: CopyTargetProps) => void;
}) {
  onProps(useCopyTarget(onCopy));
  return null;
}

function copyTargetProps(onCopy: () => void): CopyTargetProps {
  const captured: CopyTargetProps[] = [];
  renderToStaticMarkup(
    <Harness onCopy={onCopy} onProps={(props) => captured.push(props)} />,
  );
  return captured[0];
}

const noSelection = {
  isCollapsed: true,
  anchorNode: null,
  focusNode: null,
  toString: () => "",
};

function click(
  props: CopyTargetProps,
  box: FakeNode,
  target: FakeNode,
  detail = 1,
) {
  props.onClick({
    target,
    currentTarget: box,
    detail,
    defaultPrevented: false,
  } as never);
}

describe("whole-box copy target", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A box with tabs inside it, as in coco-skills' install block.
  const box = el("div", { class: "fx-copy" });
  const tablist = el("div", { role: "tablist" }, box);
  const tab = el("button", { role: "tab" }, tablist);
  const code = el("code", {}, el("pre", {}, box));

  it("copies when the box body is clicked", () => {
    vi.stubGlobal("window", { getSelection: () => noSelection });
    const onCopy = vi.fn();
    const props = copyTargetProps(onCopy);

    click(props, box, code);
    click(props, box, box);
    expect(onCopy).toHaveBeenCalledTimes(2);
  });

  it("does not copy when a tab, or the tab list around it, is clicked", () => {
    vi.stubGlobal("window", { getSelection: () => noSelection });
    const onCopy = vi.fn();
    const props = copyTargetProps(onCopy);

    click(props, box, tab);
    click(props, box, tablist);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("does not copy after a drag-select or a double click inside the box", () => {
    vi.stubGlobal("window", {
      getSelection: () => ({
        isCollapsed: false,
        anchorNode: code,
        focusNode: code,
        toString: () => "skills add",
      }),
    });
    const onCopy = vi.fn();
    const props = copyTargetProps(onCopy);

    click(props, box, code);
    vi.stubGlobal("window", { getSelection: () => noSelection });
    click(props, box, code, 2);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("presses the box's own copy button", () => {
    const button = { click: vi.fn() };
    const querySelector = vi.fn().mockReturnValue(button);

    clickCopyTarget({ querySelector } as never);
    expect(querySelector).toHaveBeenCalledWith("[data-copy-target]");
    expect(button.click).toHaveBeenCalledOnce();
  });
});

describe("copy box markup", () => {
  it("CopyTextBlock keeps the text free: one keyboard button, no overlay", () => {
    const html = renderToStaticMarkup(
      <CopyTextBlock text="claude plugin install a" label="Copy" />,
    );

    expect(html).toContain("fx-copy");
    expect(html.match(/data-copy-target/g)).toHaveLength(1);
    expect(html).not.toContain("inset-0");
  });

  it("CommandBlock is a copy box with the hint beside its button", () => {
    const html = renderToStaticMarkup(<CommandBlock commands={["npx a"]} />);

    expect(html).toContain("fx-surface fx-copy");
    expect(html).toContain("data-copy-target");
    expect(html).toContain("copy-hint");
  });

  it("InstallTabs keeps its tabs outside the copy box", () => {
    const html = renderToStaticMarkup(
      <InstallTabs
        tabs={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
        defaultId="a"
        storageKey="test:tabs"
        ariaLabel="Tabs"
      >
        {() => <CommandBlock commands={["npx a"]} />}
      </InstallTabs>,
    );

    expect(html.indexOf("fx-copy")).toBeGreaterThan(
      html.indexOf('role="tabpanel"'),
    );
  });
});
