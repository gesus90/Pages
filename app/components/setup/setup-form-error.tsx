import { AlertCircle } from "lucide-react";

interface SetupFormErrorProps {
  readonly message: string;
}

/** Renders an error that concerns the whole step, not a single field. */
export function SetupFormError({
  message,
}: SetupFormErrorProps): React.ReactElement {
  return (
    <div
      className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="pages-selectable leading-relaxed">{message}</p>
    </div>
  );
}
