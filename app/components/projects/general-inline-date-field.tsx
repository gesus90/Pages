import { Calendar } from "lucide-react";
import { useState } from "react";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Input } from "@/app/components/ui/input";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import type { ChangeEvent, KeyboardEvent } from "react";

interface InlineDateFieldProps {
  readonly value: string | null;
  readonly label: string;
  readonly onCommit: (value: string) => void;
}

/** Renders an inline date value that swaps to a native picker on click. */
export function InlineDateField({
  value,
  label,
  onCommit,
}: InlineDateFieldProps): React.ReactElement {
  const { formatDate } = useRegionFormatter();
  const [isEditing, setIsEditing] = useState(false);

  function handleOpen(): void {
    setIsEditing(true);
  }

  function handleClose(): void {
    setIsEditing(false);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onCommit(event.currentTarget.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      handleClose();
    }
  }

  if (!isEditing) {
    return (
      <button
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        type="button"
        aria-label={label}
        onClick={handleOpen}
      >
        <Calendar className="size-4 shrink-0" aria-hidden="true" />
        {formatDate(value)}
      </button>
    );
  }

  return (
    <Input
      type="date"
      defaultValue={value ?? ""}
      ref={focusOnMount}
      onChange={handleChange}
      onBlur={handleClose}
      onKeyDown={handleKeyDown}
      aria-label={label}
      className="h-9 w-40"
    />
  );
}
