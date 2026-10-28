import { expect, it } from "vitest";

import { SURFACE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";

it("fades panels on a card surface into the surface color", () => {
  expect(SURFACE_SCROLL_FADE_STYLE).toEqual({
    "--scroll-fade-color": "var(--color-surface)",
  });
});
