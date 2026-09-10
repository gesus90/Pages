// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/app/components/ui/button";

describe("Button", () => {
  it("renders its label with the default variant", () => {
    render(<Button type="submit">Anmelden</Button>);

    const button = screen.getByRole("button", { name: "Anmelden" });

    expect(button).toBeInTheDocument();
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("bg-primary");
  });

  it("defaults to a non-submitting button", () => {
    render(<Button>Abbrechen</Button>);

    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("renders the ghost variant without primary styling", () => {
    render(<Button variant="ghost">Menü</Button>);

    const button = screen.getByRole("button", { name: "Menü" });

    expect(button.className).toContain("bg-transparent");
    expect(button.className).not.toContain("bg-primary");
  });

  it("merges custom classes with variant classes", () => {
    render(
      <Button className="extra-class" variant="ghost">
        Menü
      </Button>,
    );

    expect(screen.getByRole("button").className).toContain("extra-class");
  });

  it("forwards clicks to its handler", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<Button onClick={handleClick}>Klick</Button>);

    await user.click(screen.getByRole("button", { name: "Klick" }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("supports disabled buttons", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <Button disabled onClick={handleClick}>
        Deaktiviert
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Deaktiviert" });

    expect(button).toBeDisabled();

    await user.click(button);

    expect(handleClick).not.toHaveBeenCalled();
  });

  it("forwards accessibility attributes", () => {
    render(<Button aria-label="Navigation öffnen">Menü</Button>);

    expect(
      screen.getByRole("button", { name: "Navigation öffnen" }),
    ).toBeInTheDocument();
  });
});
