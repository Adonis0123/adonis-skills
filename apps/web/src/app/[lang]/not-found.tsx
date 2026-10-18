import { Trans } from "@lingui/react/macro";
import { SectionReveal } from "@/components/motion/section-reveal";
import { ClayButton, ClaySurface } from "@/components/ui";
import { LocaleLink } from "@/i18n/locale-link";

export default function NotFoundPage() {
  return (
    <main
      id="main-content"
      className="site-page-shell site-frame site-frame--narrow flex min-h-[52vh] w-full items-center"
    >
      <SectionReveal className="w-full" delay={20}>
        <ClaySurface
          tone="base"
          elevation="floating"
          className="w-full rounded-[1.6rem] p-8 text-center md:p-12"
        >
          <p
            className="mb-3 font-heading text-5xl font-black text-link"
            aria-hidden
          >
            404
          </p>
          <h1 className="text-4xl md:text-5xl">
            <Trans id="notFound.title">Page not found</Trans>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-pretty text-muted-foreground md:text-base">
            <Trans id="notFound.description">
              Nothing lives at this address. It may have been renamed or
              removed.
            </Trans>
          </p>

          <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-center">
            <ClayButton asChild>
              <LocaleLink href="/" className="justify-center">
                <span className="icon-[lucide--house] size-4" aria-hidden />
                <Trans id="notFound.cta.home">Back to home</Trans>
              </LocaleLink>
            </ClayButton>
            <ClayButton asChild variant="secondary">
              <LocaleLink href="/#skills" className="justify-center">
                <span
                  className="icon-[lucide--layout-grid] size-4"
                  aria-hidden
                />
                <Trans id="notFound.cta.skills">Browse all skills</Trans>
              </LocaleLink>
            </ClayButton>
          </div>
        </ClaySurface>
      </SectionReveal>
    </main>
  );
}
