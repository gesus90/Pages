// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import { useActionData, useSubmit } from "react-router";

import { ProjectDescription } from "@/app/components/projects/project-description";
import { ProjectNameHeading } from "@/app/components/projects/project-name-heading";
import { ProjectStatusPill } from "@/app/components/projects/project-status-pill";
import { createI18n } from "@/app/lib/i18n";
import { MAXIMUM_PROJECT_DESCRIPTION_LENGTH } from "@/definition/Project";
import { LANGUAGE } from "@/language/Language";

import type { ReactElement } from "react";

const mockedActionData = vi.mocked(useActionData);
const mockedSubmit = vi.mocked(useSubmit);

function renderGerman(element: ReactElement): void {
  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      {element}
    </I18nextProvider>,
  );
}

function submittedFields(submit: ReturnType<typeof vi.fn>): unknown {
  const formData = submit.mock.calls[0]?.[0] as FormData;

  return Object.fromEntries(formData.entries());
}

describe("project header fields", () => {
  let submit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submit = vi.fn();
    mockedSubmit.mockReturnValue(
      submit as unknown as ReturnType<typeof useSubmit>,
    );
    mockedActionData.mockReturnValue(undefined);
  });

  describe("ProjectNameHeading", () => {
    it("shows plain text to readers", () => {
      renderGerman(<ProjectNameHeading name="Pages" canWrite={false} />);

      expect(screen.getByText("Projekt: Pages")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Projektnamen bearbeiten" }),
      ).toBeNull();
    });

    it("starts editing with the pencil button and saves a new name", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectNameHeading name="Pages" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektnamen bearbeiten" }),
      );
      const input = screen.getByRole("textbox", {
        name: "Projektnamen bearbeiten",
      });

      expect(input).toHaveValue("Pages");
      expect(input).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();

      await user.clear(input);
      await user.type(input, "Wiki");
      await user.click(screen.getByRole("button", { name: "Speichern" }));

      expect(submittedFields(submit)).toEqual({
        intent: "update-name",
        name: "Wiki",
      });
      expect(submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("starts editing by double click or Enter on the title", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectNameHeading name="Pages" canWrite />);
      await user.dblClick(screen.getByText("Projekt: Pages"));

      expect(screen.getByRole("textbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      screen.getByText("Projekt: Pages").focus();
      await user.keyboard("{Enter}");

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("offers the title to writers as a button that starts editing with a double click or Space", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectNameHeading name="Pages" canWrite />);
      await user.click(screen.getByRole("button", { name: "Projekt: Pages" }));

      expect(screen.queryByRole("textbox")).toBeNull();

      await user.dblClick(
        screen.getByRole("button", { name: "Projekt: Pages" }),
      );

      expect(screen.getByRole("textbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      screen.getByRole("button", { name: "Projekt: Pages" }).focus();
      await user.keyboard(" ");

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("ignores other keys on the title", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectNameHeading name="Pages" canWrite />);
      screen.getByText("Projekt: Pages").focus();
      await user.keyboard("a");

      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("saves with Enter and cancels with Escape", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectNameHeading name="Pages" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektnamen bearbeiten" }),
      );
      await user.type(screen.getByRole("textbox"), "{Enter}");

      expect(submit).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).toBeInTheDocument();

      await user.type(screen.getByRole("textbox"), "x");
      await user.keyboard("{Escape}");

      expect(submit).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Projektnamen bearbeiten" }),
      );
      await user.type(screen.getByRole("textbox"), "x{Enter}");

      expect(submittedFields(submit)).toEqual({
        intent: "update-name",
        name: "Pagesx",
      });
    });

    it("does not save a blank name and can be cancelled", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectNameHeading name="Pages" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektnamen bearbeiten" }),
      );
      await user.clear(screen.getByRole("textbox"));
      await user.type(screen.getByRole("textbox"), "   {Enter}");

      expect(submit).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  describe("ProjectDescription", () => {
    it("shows the text, or a hint when there is none, to readers", () => {
      const { rerender } = render(
        <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
          <ProjectDescription
            description="Wiki und Projekte"
            canWrite={false}
          />
        </I18nextProvider>,
      );

      expect(screen.getByText("Wiki und Projekte")).toBeInTheDocument();

      rerender(
        <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
          <ProjectDescription description="" canWrite={false} />
        </I18nextProvider>,
      );

      expect(
        screen.getByText("Keine Beschreibung hinterlegt."),
      ).toBeInTheDocument();
    });

    it("lets writers edit and save the description", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectDescription description="Alt" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektbeschreibung" }),
      );
      const textarea = screen.getByRole("textbox", {
        name: "Projektbeschreibung",
      });

      expect(textarea).toHaveValue("Alt");
      expect(textarea).toHaveFocus();

      await user.clear(textarea);
      await user.type(textarea, "Neu");
      await user.click(screen.getByRole("button", { name: "Speichern" }));

      expect(submittedFields(submit)).toEqual({
        description: "Neu",
        intent: "update-description",
      });
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("starts editing by double click or Enter, ignoring other keys", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectDescription description="Alt" canWrite />);
      screen.getByText("Alt").focus();
      await user.keyboard("a");

      expect(screen.queryByRole("textbox")).toBeNull();

      await user.dblClick(screen.getByText("Alt"));

      expect(screen.getByRole("textbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      screen.getByText("Alt").focus();
      await user.keyboard("{Enter}");

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("starts editing with a double click or Space on the description button", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectDescription description="Alt" canWrite />);
      await user.click(screen.getByRole("button", { name: "Alt" }));

      expect(screen.queryByRole("textbox")).toBeNull();

      await user.dblClick(screen.getByRole("button", { name: "Alt" }));

      expect(screen.getByRole("textbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      screen.getByRole("button", { name: "Alt" }).focus();
      await user.keyboard(" ");

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("closes without a request when nothing changed", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectDescription description="Alt" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektbeschreibung" }),
      );
      await user.click(screen.getByRole("button", { name: "Speichern" }));

      expect(submit).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("refuses a description beyond the limit", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectDescription description="Alt" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektbeschreibung" }),
      );
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "x".repeat(MAXIMUM_PROJECT_DESCRIPTION_LENGTH + 1) },
      });
      await user.click(screen.getByRole("button", { name: "Speichern" }));

      expect(submit).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("cancels with Escape and with the cancel button", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectDescription description="Alt" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektbeschreibung" }),
      );
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("textbox")).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Projektbeschreibung" }),
      );
      await user.type(screen.getByRole("textbox"), "x");
      await user.keyboard("a");
      await user.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(screen.queryByRole("textbox")).toBeNull();
      expect(submit).not.toHaveBeenCalled();
    });
  });

  describe("ProjectStatusPill", () => {
    it("shows the status as plain text to readers", () => {
      renderGerman(<ProjectStatusPill status="paused" canWrite={false} />);

      expect(screen.getByText("Pausiert")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Projektstatus ändern" }),
      ).toBeNull();
    });

    it("lets writers pick another status", async () => {
      const user = userEvent.setup();

      renderGerman(<ProjectStatusPill status="active" canWrite />);
      await user.click(
        screen.getByRole("button", { name: "Projektstatus ändern" }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Abgeschlossen" }));

      expect(submittedFields(submit)).toEqual({
        intent: "update-status",
        status: "completed",
      });
    });

    it("reports a failed change until a change succeeds", async () => {
      const user = userEvent.setup();

      mockedActionData.mockReturnValue({ error: "invalidInput", ok: false });
      renderGerman(<ProjectStatusPill status="active" canWrite />);

      expect(screen.queryByRole("alert")).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Projektstatus ändern" }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Pausiert" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Der Status konnte nicht gespeichert werden.",
      );
    });

    it("clears the error once the action reports success", async () => {
      const user = userEvent.setup();

      mockedActionData.mockReturnValue({ error: "invalidInput", ok: false });
      const { rerender } = render(
        <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
          <ProjectStatusPill status="active" canWrite />
        </I18nextProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Projektstatus ändern" }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Pausiert" }));
      mockedActionData.mockReturnValue({ ok: true });
      rerender(
        <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
          <ProjectStatusPill status="paused" canWrite />
        </I18nextProvider>,
      );

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
