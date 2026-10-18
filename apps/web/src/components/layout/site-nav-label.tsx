import { Trans } from "@lingui/react/macro";
import type { SiteNavItem } from "@/config/site-layout";

/** Visible label for a header nav item; shared by the desktop header and the mobile menu. */
export function SiteNavLabel({ id }: { id: SiteNavItem["id"] }) {
  switch (id) {
    case "skills":
      return <Trans id="siteHeader.nav.skills.label">Skills</Trans>;
    case "scenarios":
      return <Trans id="siteHeader.nav.scenarios.label">Scenarios</Trans>;
    case "install":
      return <Trans id="siteHeader.nav.install.label">Install</Trans>;
    case "github":
      return <Trans id="siteHeader.nav.github.label">GitHub</Trans>;
  }
}
