import { AlertCircle } from "lucide-react";

/** Shows an error that concerns a whole block in the DESIGN form/block error style. */
export function AgentAlert({
  id,
  message,
}: {
  readonly id?: string;
  readonly message: string;
}): React.ReactElement {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="pages-selectable leading-relaxed">{message}</p>
    </div>
  );
}
