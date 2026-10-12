import { AlertCircle } from "lucide-react";

/** Shows an error that concerns a whole block in the DESIGN form/block error style. */
export function AgentAlert({
  id,
  message,
  details = [],
}: {
  readonly id?: string;
  readonly message: string;
  /** Names that explain the error, such as the agents that block a deletion. */
  readonly details?: readonly string[];
}): React.ReactElement {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">
        <p className="pages-selectable leading-relaxed">{message}</p>
        {details.length > 0 ? (
          <ul className="pages-selectable list-disc space-y-0.5 pl-4 break-words">
            {details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
