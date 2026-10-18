import { SmoothScrollProvider } from "@/components/motion/smooth-scroll";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

interface SiteShellProps {
  children: React.ReactNode;
}

export function SiteShell({ children }: SiteShellProps) {
  return (
    <div className="site-shell">
      {/* Same-page #hash links (hero CTA, scenario chips, header nav) scroll smoothly. */}
      <SmoothScrollProvider />
      <SiteHeader />
      <div id="site-content" className="flex-1">
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}
