import type { SkillShowcase as SkillShowcaseData } from "@/lib/skills";
import { renderSectionContent } from "@/lib/skill-markdown";
import { ClayBadge, ClaySurface } from "@/components/ui";

interface SkillShowcaseProps {
  showcase: SkillShowcaseData;
}

export function SkillShowcase({ showcase }: SkillShowcaseProps) {
  return (
    <section aria-labelledby="skill-showcase-title" className="grid gap-4">
      <ClaySurface
        tone="blue"
        elevation="inset"
        className="rounded-[1.1rem] p-5 md:p-6"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] lg:items-start">
          <div>
            <ClayBadge
              tone="blue"
              className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em]"
            >
              {showcase.hero.badge}
            </ClayBadge>
            <h2
              id="skill-showcase-title"
              className="font-heading text-2xl text-foreground md:text-3xl"
            >
              {showcase.hero.title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-clay-muted">
              {showcase.hero.summary}
            </p>
          </div>

          <ol
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
            aria-label="Showcase highlights"
          >
            {showcase.hero.keyMoments.map((moment, index) => (
              <li
                key={`${moment}-${index}`}
                className="flex gap-3 rounded-xl border border-border/60 bg-background/55 p-3"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#87a6dd]/20 font-mono text-xs font-semibold text-[#5875ad]">
                  {index + 1}
                </span>
                <span className="text-sm leading-6 text-foreground/85">
                  {moment}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </ClaySurface>

      <div className="grid gap-4 xl:grid-cols-2">
        {showcase.sections.map((section, sectionIndex) => (
          <ClaySurface
            key={section.id}
            tone="base"
            elevation="raised"
            className="rounded-[1.1rem] p-5 md:p-6"
          >
            <div className="mb-4 flex items-start gap-3">
              <ClayBadge
                tone="peach"
                className="shrink-0 font-mono text-[11px]"
              >
                {String(sectionIndex + 1).padStart(2, "0")}
              </ClayBadge>
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {section.title}
                </h3>
                <p className="mt-1 text-sm leading-6 text-clay-muted">
                  {section.intro}
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {section.messages.map((message, messageIndex) => (
                <div
                  key={`${section.id}-${message.role}-${messageIndex}`}
                  className="grid gap-2"
                >
                  <ClaySurface
                    tone={message.role === "user" ? "cream" : "muted"}
                    elevation="inset"
                    className="rounded-xl p-4"
                  >
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-clay-muted">
                      {message.role === "user" ? "User request" : "Audit agent"}
                    </p>
                    <div className="space-y-3">
                      {renderSectionContent(message.content)}
                    </div>
                  </ClaySurface>

                  {message.toolCalls?.map((toolCall) => (
                    <div
                      key={`${section.id}-${toolCall.name}`}
                      className="rounded-xl border border-[#87a6dd]/35 bg-[#87a6dd]/8 p-3.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <ClayBadge
                          tone="blue"
                          className="font-mono text-[10px]"
                        >
                          {toolCall.name}
                        </ClayBadge>
                        <span className="text-xs leading-5 text-clay-muted">
                          {toolCall.summary}
                        </span>
                      </div>
                      <p className="mt-2 flex gap-2 text-sm leading-6 text-foreground/85">
                        <span
                          className="icon-[lucide--circle-check-big] mt-1 size-4 shrink-0 text-[#6f8fc7]"
                          aria-hidden
                        />
                        <span>{toolCall.result}</span>
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </ClaySurface>
        ))}
      </div>
    </section>
  );
}
