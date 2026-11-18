import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { siteUrl } from "@/config/site-layout";
import designSystem from "@/styles/brand/design-system.json";
import { resolveLightRoleHex } from "@/lib/og-palette";

export const OG_SIZE = { width: 1200, height: 630 };

// Same roles as the page in light mode (rubber-hose look): warm paper, brown
// ink, the teal accent, and a 2px ink rule like the page's dividers.
const palette = {
  paper: resolveLightRoleHex(designSystem, "background"),
  ink: resolveLightRoleHex(designSystem, "foreground"),
  inkSoft: resolveLightRoleHex(designSystem, "muted-foreground"),
  accent: resolveLightRoleHex(designSystem, "link"),
  line: resolveLightRoleHex(designSystem, "ink"),
};

// Paths are relative to apps/web, the working directory for `next build`.
async function loadAssets() {
  // Patrick Hand, the site's hand lettering; it has one weight (400).
  const [kiki, handFont] = await Promise.all([
    readFile(path.join(process.cwd(), "public/brand/kiki-plate.svg"), "utf8"),
    readFile(
      path.join(
        process.cwd(),
        "node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff",
      ),
    ),
  ]);
  return {
    kikiDataUri: `data:image/svg+xml;base64,${Buffer.from(kiki).toString("base64")}`,
    fonts: [
      {
        name: "Patrick Hand",
        data: handFont,
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
        background: palette.paper,
        color: palette.ink,
        fontFamily: "Patrick Hand",
        fontWeight: 400,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img src={kikiDataUri} width={88} height={88} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 52,
            WebkitTextStroke: `1.5px ${palette.ink}`,
          }}
        >
          <span>nika&nbsp;</span>
          <span style={{ color: palette.accent }}>skills</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: title.length > 28 ? 70 : 88,
            lineHeight: 1.08,
            // Patrick Hand has one weight: an ink stroke gives the title the
            // page's marker weight, and balance avoids a lone last word.
            WebkitTextStroke: `2.5px ${palette.ink}`,
            textWrap: "balance",
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
