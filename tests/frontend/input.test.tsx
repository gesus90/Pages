import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/app/components/ui/input";

describe("Input", () => {
  it("renders a labelled text field", async () => {
    const user = userEvent.setup();

    render(<Input aria-label="Benutzername" placeholder="Benutzername" />);

    const field = screen.getByLabelText("Benutzername");

    await user.type(field, "admin");

    expect(field).toHaveValue("admin");
  });

  it("supports password fields", () => {
    render(<Input aria-label="Passwort" type="password" />);

    expect(screen.getByLabelText("Passwort").getAttribute("type")).toBe(
      "password",
    );
  });

  it("merges custom classes with the default styling", () => {
    render(<Input aria-label="Feld" className="custom-field" />);

    expect(screen.getByLabelText("Feld").className).toContain("custom-field");
    expect(screen.getByLabelText("Feld").className).toContain("rounded-lg");
  });

  it("forwards change events", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(<Input aria-label="Feld" onChange={handleChange} />);

    await user.type(screen.getByLabelText("Feld"), "a");

    expect(handleChange).toHaveBeenCalled();
  });

  it("supports disabled and required states", () => {
    render(<Input aria-label="Deaktiviert" disabled required />);

    const field = screen.getByLabelText("Deaktiviert");

    expect(field).toBeDisabled();
    expect(field).toBeRequired();
  });

  it("forwards placeholder and autocomplete attributes", () => {
    render(
      <Input
        aria-label="Benutzername"
        autoComplete="username"
        placeholder="Benutzername"
      />,
    );

    const field = screen.getByLabelText("Benutzername");

    expect(field).toHaveAttribute("placeholder", "Benutzername");
    expect(field).toHaveAttribute("autocomplete", "username");
  });
});
