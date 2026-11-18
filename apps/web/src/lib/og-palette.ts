// ImageResponse cannot read CSS variables, so the OG card resolves light-mode
// roles from the design-system snapshot (synced from adonis-brand) instead of
// copying hex values. Only plain scale references are supported: "{accent-N}"
// for the theme, or "{<scale>-N}" for any scale in the snapshot (neutral,
// paper, ...).

export interface DesignSystemSnapshot {
  scales: Record<string, { light: string[]; dark: string[] }>;
  theme: { scale: { light: string[]; dark: string[] } };
  roles: { light: Record<string, string> };
}

export function resolveLightRoleHex(
  ds: DesignSystemSnapshot,
  role: string,
): string {
  const ref = /^\{([a-z]+)-(\d+)\}$/.exec(ds.roles.light[role] ?? "");
  const scale = !ref
    ? undefined
    : ref[1] === "accent"
      ? ds.theme.scale.light
      : ds.scales[ref[1]]?.light;
  const hex = ref && scale ? scale[Number(ref[2]) - 1] : undefined;
  if (!hex)
    throw new Error(
      `Design-system role "${role}" is not a plain scale step ("{scale-N}") in apps/web/src/styles/brand/design-system.json; point it at a scale step or resolve it in lib/og-palette.ts`,
    );
  return hex;
}
