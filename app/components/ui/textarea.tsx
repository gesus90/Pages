import { useCallback, useState } from "react";

import { cn } from "@/app/lib/cn";

import { NativeScrollFades } from "./scroll-viewport/native-scroll-fades";

import type { ComponentProps } from "react";

/** Props accepted by the shared Pages textarea. */
export type TextareaProps = ComponentProps<"textarea"> & {
  readonly containerClassName?: string;
};

/** Renders a Pages-styled native textarea. */
export function Textarea({
  className,
  containerClassName,
  ref,
  ...properties
}: TextareaProps): React.ReactElement {
  const [container, setContainer] = useState<HTMLSpanElement | null>(null);
  const [viewport, setViewport] = useState<HTMLTextAreaElement | null>(null);
  const setInput = useCallback(
    (element: HTMLTextAreaElement | null): void => {
      setViewport(element);
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  return (
    <span
      ref={setContainer}
      className={cn("relative block min-w-0", containerClassName)}
    >
      <textarea
        ref={setInput}
        className={cn(
          "min-h-24 w-full rounded-xl bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-field outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...properties}
      />
      {container && viewport ? (
        <NativeScrollFades viewport={viewport} container={container} />
      ) : null}
    </span>
  );
}
