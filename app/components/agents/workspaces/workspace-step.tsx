import { useId } from "react";

import type { ReactNode } from "react";

/** One numbered part of the registration form, so the order of choices is visible. */
export function WorkspaceStep(props: {
  readonly number: number;
  readonly title: string;
  readonly children: ReactNode;
}): React.ReactElement {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-border p-4"
    >
      <h3
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {props.number}
        </span>
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}
