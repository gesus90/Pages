import { render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, vi } from "vitest";

import { SearchableSelect } from "@/app/components/ui/searchable-select";

import type { SearchableSelectOption } from "@/app/components/ui/searchable-select/use-searchable-select";
import type { RenderResult } from "@testing-library/react";

export const OPTIONS: readonly SearchableSelectOption[] = [
  {
    value: "alpha",
    label: "Alpha",
    keywords: ["First provider"],
    tags: ["free", "fast"],
  },
  { value: "unavailable", label: "Disabled choice", disabled: true },
  { value: "beta", label: "Beta", tags: ["free"] },
  {
    value: "gamma",
    label: "Gamma",
    keywords: ["Third provider"],
    tags: ["fast"],
  },
];

const TEXTS = {
  placeholder: "Choose a model",
  unavailable: "unavailable",
  search: "Search models",
  empty: "No matching models",
  count: (count: number, total: number): string => `${count} of ${total}`,
};

// jsdom has no layout or scrolling; selection and focus stay real DOM behavior.
const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  if (originalScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScroll,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

/** Renders a controlled select with local state and observable change notifications. */
export function renderSelect(
  input: {
    readonly value?: string;
    readonly disabled?: boolean;
    readonly options?: readonly SearchableSelectOption[];
  } = {},
): RenderResult & { readonly changed: ReturnType<typeof vi.fn> } {
  const changed = vi.fn();
  function ControlledSelect(): React.ReactElement {
    const [value, setValue] = useState(input.value ?? "");
    return (
      <SearchableSelect
        id="model"
        label="Model"
        value={value}
        disabled={input.disabled}
        options={input.options ?? OPTIONS}
        texts={TEXTS}
        filters={[
          { tag: "free", label: "Free" },
          { tag: "fast", label: "Fast" },
        ]}
        onValueChange={(next) => {
          setValue(next);
          changed(next);
        }}
      />
    );
  }
  return { ...render(<ControlledSelect />), changed };
}
