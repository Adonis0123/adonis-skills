import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { siteUrl } from "@/config/site-layout";
import designSystem from "@/styles/brand/design-system.json";

export const OG_SIZE = { width: 1200, height: 630 };

// ImageResponse cannot read CSS variables, so resolve light-mode roles from
// the design-system snapshot (synced from adonis-brand) instead of copying hex
// values here. Only plain scale references ("{neutral-2}") are supported.
function roleHex(role: keyof typeof designSystem.roles.light): string {
  const ref = /^\{(neutral|accent)-(\d+)\}$/.exec(
    designSystem.roles.light[role],
  );
  const scale =
    ref?.[1] === "accent"
      ? designSystem.theme.scale.light
      : designSystem.scales.neutral.light;
  const hex = ref ? scale[Number(ref[2]) - 1] : undefined;
  if (!hex)
    throw new Error(
      `Design-system role "${role}" is not a plain scale step in apps/web/src/styles/brand/design-system.json`,
    );
  return hex;
}

// Same roles as the page in light mode.
const palette = {
  cream: roleHex("background"),
  ink: roleHex("foreground"),
  inkSoft: roleHex("muted-foreground"),
  accent: roleHex("link"),
  line: roleHex("border"),
};

// Paths are relative to apps/web, the working directory for `next build`.
async function loadAssets() {
  const fontFile = (weight: number) =>
    readFile(
      path.join(
        process.cwd(),
        `node_modules/@fontsource/shantell-sans/files/shantell-sans-latin-${weight}-normal.woff`,
      ),
    );
  const [kiki, boldFont, regularFont] = await Promise.all([
    readFile(path.join(process.cwd(), "public/brand/kiki-plate.svg"), "utf8"),
    fontFile(800),
    fontFile(400),
  ]);
  return {
    kikiDataUri: `data:image/svg+xml;base64,${Buffer.from(kiki).toString("base64")}`,
    fonts: [
      {
        name: "Shantell Sans",
        data: boldFont,
        weight: 800 as const,
        style: "normal" as const,
      },
      {
        name: "Shantell Sans",
        data: regularFont,
        weight: 400 as const,
        style: "normal" as const,
      },
    ],
  };
}

interface OgCardProps {
  title: string;
  description: string;
}

/** Brand card for Open Graph images. English only: CJK fonts would bloat every image route. */
export async function renderOgCard({
  title,
  description,
}: OgCardProps): Promise<ImageResponse> {
  const { kikiDataUri, fonts } = await loadAssets();
  const host = new URL(siteUrl).host;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: palette.cream,
        color: palette.ink,
        fontFamily: "Shantell Sans",
        fontWeight: 400,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img src={kikiDataUri} width={88} height={88} alt="" />
        <div style={{ display: "flex", fontSize: 44, fontWeight: 800 }}>
          <span>nika&nbsp;</span>
          <span style={{ color: palette.accent }}>skills</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: title.length > 28 ? 64 : 80,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -1.5,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 32,
            lineHeight: 1.35,
            color: palette.inkSoft,
            maxWidth: 1000,
          }}
        >
          {description}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: `2px solid ${palette.line}`,
          paddingTop: 24,
          fontSize: 26,
          color: palette.inkSoft,
        }}
      >
        <span>Made by Nika</span>
        <span>{host}</span>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts,
    },
  );
}
