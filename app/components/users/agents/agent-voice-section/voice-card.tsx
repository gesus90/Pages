/** One card of the voice tab: an icon, a title, a description and its content. */
export function VoiceCard({
  icon,
  title,
  description,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-border/70 sm:p-5">
      <header className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}
