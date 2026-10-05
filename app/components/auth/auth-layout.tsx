import type { ReactNode } from "react";

interface AuthLayoutProps {
  /** Controls at the top of the page, such as the language switcher. */
  readonly header?: ReactNode;
  /** Content below the card, such as the version line. */
  readonly footer?: ReactNode;
  /** Content of the central card. */
  readonly children: ReactNode;
}

/**
 * Renders the stage of the login and setup pages: background glows and
 * one central card (DESIGN.md §14.1).
 *
 * @remarks
 * Text of these pages is not selectable, apart from fields and content
 * marked with `.pages-selectable` (DESIGN.md §10.1).
 */
export function AuthLayout({
  header,
  footer,
  children,
}: AuthLayoutProps): React.ReactElement {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-24 select-none sm:px-6 sm:py-16">
      <div
        className="pointer-events-none absolute -top-32 left-[8%] size-80 rounded-full bg-auth-glow-warm/60 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-32 -bottom-40 size-96 rounded-full bg-auth-glow-cool/60 blur-3xl"
        aria-hidden="true"
      />

      {header ? (
        <header className="absolute inset-x-0 top-0 flex items-center justify-end px-4 py-5 sm:px-10 sm:py-6">
          {header}
        </header>
      ) : null}

      <section className="relative z-10 w-full max-w-md rounded-3xl bg-surface p-6 shadow-floating sm:p-8">
        {children}
      </section>

      {footer}
    </main>
  );
}
