import Image from "next/image";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import {
  type FooterLinkGroup,
  type FooterLinkItem,
  siteLayoutConfig,
} from "@/config/site-layout";
import { SiteBrand } from "@/components/layout/site-brand";
import { LocaleLink } from "@/i18n/locale-link";
import { getIllustrationSrc } from "@/lib/skills";

const FOOTER_ILLUSTRATION = "group-delegate.webp";

const linkClass =
  "clay-focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground";

function GroupTitle({ id }: { id: FooterLinkGroup["id"] }) {
  return id === "library" ? (
    <Trans id="siteFooter.group.library">Library</Trans>
  ) : (
    <Trans id="siteFooter.group.resources">Resources</Trans>
  );
}

function LinkLabel({ id }: { id: FooterLinkItem["id"] }) {
  switch (id) {
    case "skill-library":
      return <Trans id="siteFooter.link.allSkills">All skills</Trans>;
    case "scenarios":
      return <Trans id="siteFooter.link.scenarios">Scenarios</Trans>;
    case "install":
      return <Trans id="siteFooter.link.installGuide">Install guide</Trans>;
    case "github-repository":
      return (
        <Trans id="siteFooter.link.githubRepository">GitHub repository</Trans>
      );
    case "readme":
      return <Trans id="siteFooter.link.readme">README</Trans>;
  }
}

export function SiteFooter() {
  const { brand, footerGroups } = siteLayoutConfig;
  const year = new Date().getFullYear();
  const brandName = brand.name;
  const owner = siteLayoutConfig.ownerDisplay;
  const ownerUrl = `https://github.com/${owner}`;

  return (
    <footer className="site-footer-plate safe-area-bottom">
      <div className="site-frame grid grid-cols-2 gap-8 pt-10 pb-8 md:grid-cols-[1.3fr_1fr_1fr_200px] md:pt-12 md:pb-10">
        <section className="col-span-2 flex min-w-0 items-start justify-between gap-4 md:col-span-1">
          <div className="min-w-0">
            <SiteBrand variant="footer" brand={brand} />
            <p className="mt-3 max-w-[300px] text-sm text-muted-foreground">
              <Trans id="siteFooter.brand.lantern">
                Field-tested coding skills I use every day. Carried around like
                a lantern.
              </Trans>
            </p>
          </div>
          {/* Mobile keeps the characters beside the brand; desktop gives them their own column. */}
          <Image
            src={getIllustrationSrc(FOOTER_ILLUSTRATION)}
            alt=""
            width={1024}
            height={1024}
            sizes="96px"
            className="-mt-2 size-24 shrink-0 object-contain md:hidden"
          />
        </section>

        {footerGroups.map((group) => (
          <section key={group.id}>
            <h2 className="kicker text-muted-foreground">
              <GroupTitle id={group.id} />
            </h2>
            <ul className="mt-3.5 grid gap-2.5">
              {group.links.map((link) => (
                <li key={link.id}>
                  {link.external ? (
                    <Link
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      <LinkLabel id={link.id} />
                      <span
                        className="icon-[lucide--arrow-up-right] size-3.5"
                        aria-hidden
                      />
                    </Link>
                  ) : (
                    <LocaleLink href={link.href} className={linkClass}>
                      <LinkLabel id={link.id} />
                    </LocaleLink>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="hidden justify-end md:flex">
          <Image
            src={getIllustrationSrc(FOOTER_ILLUSTRATION)}
            alt=""
            width={1024}
            height={1024}
            sizes="160px"
            className="-my-4 size-40 object-contain"
          />
        </div>
      </div>

      <div className="site-frame flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 pb-5 text-[13px] text-muted-foreground">
        <p>
          <Trans id="siteFooter.copyright">
            © {year} {brandName}
          </Trans>
        </p>
        <p>
          <Trans id="siteFooter.attribution">
            Made by <span className="font-semibold text-link">Nika</span> · code
            on GitHub{" "}
            <Link
              href={ownerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="clay-focus-ring rounded-sm text-link underline-offset-2 hover:underline"
            >
              @{owner}
            </Link>
          </Trans>
        </p>
      </div>
    </footer>
  );
}
