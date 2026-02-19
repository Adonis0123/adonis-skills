import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

interface SiteShellProps {
  children: React.ReactNode
}

export function SiteShell({ children }: SiteShellProps) {
  return (
    <div className="site-shell">
      <SiteHeader />
      <div id="site-content" className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  )
}
