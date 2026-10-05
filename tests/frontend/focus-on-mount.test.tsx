// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { focusOnMount } from "@/app/lib/focus-on-mount";

describe("focusOnMount", () => {
  it("focuses the element when it mounts", () => {
    render(<input aria-label="Feld" ref={focusOnMount} />);

    expect(screen.getByLabelText("Feld")).toHaveFocus();
  });

  it("keeps the focus where the user moved it on re-render", () => {
    const { rerender } = render(
      <>
        <input aria-label="Feld" ref={focusOnMount} />
        <button type="button">Weiter</button>
      </>,
    );

    screen.getByRole("button", { name: "Weiter" }).focus();
    rerender(
      <>
        <input aria-label="Feld" ref={focusOnMount} />
        <button type="button">Weiter</button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Weiter" })).toHaveFocus();
  });

  it("ignores a detached element", () => {
    expect(() => focusOnMount(null)).not.toThrow();
  });
});
