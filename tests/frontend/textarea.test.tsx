// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Textarea } from "@/app/components/ui/textarea";
import { focusOnMount } from "@/app/lib/focus-on-mount";

describe("Textarea", () => {
  it("merges custom classes with the default styling", () => {
    render(<Textarea aria-label="Beschreibung" className="custom-area" />);

    const field = screen.getByLabelText("Beschreibung");

    expect(field.className).toContain("custom-area");
    expect(field.className).toContain("rounded-xl");
  });

  it("hands the native textarea to a ref", () => {
    render(<Textarea aria-label="Beschreibung" ref={focusOnMount} />);

    expect(screen.getByLabelText("Beschreibung")).toHaveFocus();
  });
});
