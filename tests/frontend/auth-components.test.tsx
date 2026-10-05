// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { UserRound } from "lucide-react";
import { describe, expect, it } from "vitest";

import { AuthField } from "@/app/components/auth/auth-field";
import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { AuthSubmitButton } from "@/app/components/auth/auth-submit-button";
import { Input } from "@/app/components/ui/input";

describe("AuthLayout", () => {
  it("renders the card without header and footer", () => {
    const { container } = render(
      <AuthLayout>
        <p>Inhalt</p>
      </AuthLayout>,
    );

    expect(screen.getByText("Inhalt")).toBeInTheDocument();
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("main")).toHaveClass("select-none");
  });

  it("places header controls and footer around the card", () => {
    render(
      <AuthLayout header={<button type="button">DE</button>} footer={<p>v1</p>}>
        <p>Inhalt</p>
      </AuthLayout>,
    );

    expect(screen.getByRole("banner")).toContainElement(
      screen.getByRole("button", { name: "DE" }),
    );
    expect(screen.getByText("v1")).toBeInTheDocument();
  });
});

describe("AuthHeading", () => {
  it("shows the logo by default and can leave it out", () => {
    const { rerender } = render(<AuthHeading title="Titel" subtitle="Text" />);

    expect(screen.getByRole("img", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Titel" })).toBeInTheDocument();

    rerender(<AuthHeading title="Titel" subtitle="Text" hasLogo={false} />);

    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("AuthField", () => {
  it("links a description without marking the field invalid", () => {
    render(
      <>
        <AuthField
          name="path"
          label="Pfad"
          icon={UserRound}
          describedBy="hint"
        />
        <p id="hint">Hinweis</p>
      </>,
    );

    const field = screen.getByLabelText("Pfad");

    expect(field).toHaveAttribute("aria-describedby", "hint");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field.className).toContain("pl-12");
    expect(field.className).not.toContain("pr-14");
  });

  it("links the error and the description together", () => {
    render(
      <AuthField
        name="path"
        label="Pfad"
        icon={UserRound}
        describedBy="hint"
        error="Kaputt"
      >
        <button type="button">Aktion</button>
      </AuthField>,
    );

    const field = screen.getByLabelText("Pfad");

    expect(field).toHaveAttribute("aria-describedby", "path-error hint");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.className).toContain("pr-14");
    expect(screen.getByText("Kaputt")).toHaveClass("pages-selectable");
  });

  it("describes nothing without error or description", () => {
    render(<AuthField name="name" label="Name" icon={UserRound} />);

    expect(screen.getByLabelText("Name")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

describe("AuthSubmitButton", () => {
  it("shows a spinner with the label while the action runs", () => {
    const { rerender } = render(
      <AuthSubmitButton
        label="Weiter"
        pendingLabel="Läuft …"
        isPending={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Weiter" })).toBeEnabled();
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");

    rerender(
      <AuthSubmitButton label="Weiter" pendingLabel="Läuft …" isPending />,
    );

    const button = screen.getByRole("button", { name: "Läuft …" });

    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("can be disabled without running", () => {
    render(
      <AuthSubmitButton
        label="Fertig"
        pendingLabel="…"
        isPending={false}
        disabled
        type="button"
      />,
    );

    expect(screen.getByRole("button", { name: "Fertig" })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("Input auth variant", () => {
  it("uses the field tokens of the login and setup pages", () => {
    render(<Input aria-label="Feld" variant="auth" />);

    const className = screen.getByLabelText("Feld").className;

    expect(className).toContain("bg-field");
    expect(className).toContain("border-field-border");
    expect(className).not.toContain("bg-surface");
  });
});
