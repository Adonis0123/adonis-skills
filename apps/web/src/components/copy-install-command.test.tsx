import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./copy-install-command";

// The Lingui macro is compiled away by SWC in Next; vitest runs uncompiled source.
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: () => "" }) }));

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCopy = vi.fn().mockReturnValue(true);

    await expect(
      copyTextToClipboard("npx skills add a", { writeText, execCopy }),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("npx skills add a");
    expect(execCopy).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const execCopy = vi.fn().mockReturnValue(true);

    await expect(
      copyTextToClipboard("a\nb", { writeText, execCopy }),
    ).resolves.toBe(true);
    expect(execCopy).toHaveBeenCalledWith("a\nb");
  });

  it("falls back to execCommand when the Clipboard API is missing", async () => {
    const execCopy = vi.fn().mockReturnValue(true);

    await expect(copyTextToClipboard("a", { execCopy })).resolves.toBe(true);
  });

  it("reports failure when both paths fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));

    await expect(
      copyTextToClipboard("a", { writeText, execCopy: () => false }),
    ).resolves.toBe(false);
    await expect(
      copyTextToClipboard("a", {
        writeText,
        execCopy: () => {
          throw new Error("unsupported");
        },
      }),
    ).resolves.toBe(false);
  });
});
