import type { ReactNode } from "react";

interface AdminFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (content: string) => void;
  readonly multiline?: boolean;
}

/** A labeled text control using the existing surface and focus tokens. */
export function AdminField({
  label,
  value,
  onChange,
  multiline,
}: AdminFieldProps): React.ReactElement {
  const className =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus-visible:outline-primary";
  return (
    <label className="block">
      {label}
      {multiline ? (
        <textarea
          className={className}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={className}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

interface AdminButtonProps {
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
}

/** An explicit task action with the existing button treatment. */
export function AdminButton({
  onClick,
  children,
  disabled,
}: AdminButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded-lg border border-border bg-surface px-4 py-2 text-foreground hover:bg-sidebar-hover disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Shared props of the two independent task sections. */
export interface AdminSectionProps {
  readonly isBusy: boolean;
  readonly run: (
    tool: string,
    parameters: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
}
