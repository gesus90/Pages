import iconUrl from "@/assets/icon.png";

interface AuthHeadingProps {
  readonly title: string;
  readonly subtitle: string;
  /** Whether the Pages logo is shown above the title. */
  readonly hasLogo?: boolean;
}

/** Renders the logo, title, and subtitle of a login or setup card. */
export function AuthHeading({
  title,
  subtitle,
  hasLogo = true,
}: AuthHeadingProps): React.ReactElement {
  return (
    <>
      {hasLogo ? (
        <img
          className="mx-auto mb-8 h-auto w-[140px] sm:w-[160px]"
          src={iconUrl}
          alt="Pages"
          draggable={false}
        />
      ) : null}
      <h1 className="text-center text-2xl leading-tight font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground sm:text-base">
        {subtitle}
      </p>
    </>
  );
}
