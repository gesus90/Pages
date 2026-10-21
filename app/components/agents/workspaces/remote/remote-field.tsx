import type { ReactNode } from "react";

/** A label above its field, at the spacing of the searchable select. */
export function RemoteField(props: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children}
    </div>
  );
}
