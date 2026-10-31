import type { ReactNode } from "react";

interface ToolbarFilterFieldProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly order: string;
}

/** Gives a filter its visible caption and its place in the panel. */
export function ToolbarFilterField({
  children,
  label,
  order,
}: ToolbarFilterFieldProps): React.ReactElement {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${order}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
