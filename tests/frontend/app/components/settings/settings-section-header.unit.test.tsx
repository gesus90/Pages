import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";

function renderHeader(): HTMLElement {
  const { container } = render(
    <SettingsSectionHeader
      icon={<svg />}
      title="Personal"
      description="Profile and appearance"
    />,
  );
  const surface = container.querySelector<HTMLElement>(
    ".pages-sticky-band-surface",
  );

  if (surface === null) {
    throw new Error("The heading rendered no band surface.");
  }

  return surface;
}

it("PAGE-324: paints the band and its fade with the design's band surface", () => {
  const classes = renderHeader().classList;

  expect(classes).toContain("bg-(--sticky-band-surface)");
  expect(classes).toContain("after:from-(--sticky-band-surface)");
  // An opaque page color would show as a band over the painting of Koi Garden.
  expect(classes).not.toContain("bg-background");
  expect(classes).not.toContain("after:from-background");
});

it("keeps the band surface decorative and behind the heading text", () => {
  const surface = renderHeader();

  expect(surface.getAttribute("aria-hidden")).toBe("true");
  expect(surface.classList).toContain("-z-10");
  expect(surface.parentElement?.classList).toContain("pages-sticky-band");
  expect(surface.parentElement?.classList).toContain("sticky");
});
