import { expect, it } from "vitest";

import { focusOnMount } from "@/app/lib/focus-on-mount";

it("focuses the element React attaches", () => {
  const field = document.createElement("input");
  document.body.append(field);

  focusOnMount(field);

  expect(document.activeElement).toBe(field);
  field.remove();
});

it("does nothing when React detaches the element", () => {
  expect(() => {
    focusOnMount(null);
  }).not.toThrow();
});
