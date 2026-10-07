// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { ProjectDepartmentChoices } from "@/app/components/projects/project-department-choices";
import { ProjectDepartmentChips } from "@/app/components/projects/project-department-chips";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

const DEPARTMENTS = [
  { id: "frontend", name: "Frontend" },
  { id: "backend", name: "Backend" },
];

interface SelectionHarnessProps {
  readonly required?: boolean;
  readonly initial?: readonly string[];
}

function SelectionHarness({
  required = true,
  initial = [],
}: SelectionHarnessProps): React.ReactElement {
  const [selected, setSelected] = useState<readonly string[]>(initial);
  return (
    <form aria-label="Project">
      <ProjectDepartmentChoices
        available={DEPARTMENTS}
        selected={selected}
        selectionRequired={required}
        onChange={setSelected}
      />
    </form>
  );
}

describe("project department displays", () => {
  it("shows named chips and an explicit departmentless state", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ProjectDepartmentChips departments={DEPARTMENTS} />
      </I18nextProvider>,
    );
    expect(
      screen.getByRole("list", { name: "Abteilungen" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Frontend")).toBeInTheDocument();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProjectDepartmentChips departments={[]} />
      </I18nextProvider>,
    );
    expect(screen.getByText("Ohne Abteilung")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("retains the last required selection and submits all selected IDs", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <SelectionHarness />
      </I18nextProvider>,
    );
    const frontend = screen.getByRole("checkbox", { name: "Frontend" });
    const backend = screen.getByRole("checkbox", { name: "Backend" });
    expect(frontend).not.toBeChecked();
    await user.click(frontend);
    expect(frontend).toBeChecked();
    expect(frontend).toBeDisabled();
    await user.click(backend);
    expect(frontend).toBeEnabled();
    const form = screen.getByRole("form", {
      name: "Project",
    }) as HTMLFormElement;
    expect(new FormData(form).getAll("departmentIds")).toEqual([
      "frontend",
      "backend",
    ]);
    await user.click(frontend);
    expect(frontend).not.toBeChecked();
    expect(backend).toBeDisabled();
    expect(new FormData(form).getAll("departmentIds")).toEqual(["backend"]);
    expect(
      screen.getByText(/Mindestens eine Abteilung bleibt/),
    ).toBeInTheDocument();
  });

  it("allows an empty choice when the instance has no department requirement", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n(LANGUAGE.ENGLISH)}>
        <SelectionHarness required={false} initial={["frontend"]} />
      </I18nextProvider>,
    );
    const frontend = screen.getByRole("checkbox", { name: "Frontend" });
    expect(frontend).toBeEnabled();
    await user.click(frontend);
    expect(frontend).not.toBeChecked();
    expect(screen.getByText("Departments")).toBeInTheDocument();
  });

  it("distinguishes an empty catalog from an empty management scope", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ProjectDepartmentChoices
          available={[]}
          selected={[]}
          selectionRequired={false}
          onChange={() => {
            throw new Error("No choices available");
          }}
        />
      </I18nextProvider>,
    );
    expect(
      screen.getByText(/Es sind noch keine Abteilungen vorhanden/),
    ).toBeInTheDocument();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProjectDepartmentChoices
          available={[]}
          selected={[]}
          selectionRequired
          onChange={() => {
            throw new Error("No choices available");
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(/keine Abteilungen verfügbar/)).toBeInTheDocument();
    expect(screen.getByText("Abteilungen (Pflichtfeld)")).toBeInTheDocument();
  });
});
