// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import DescriptionEditor from "@/app/components/tasks/description/description-editor";
import {
  DescriptionActions,
  DescriptionConflict,
} from "@/app/components/tasks/description/description-parts";
import { createI18n } from "@/app/lib/i18n";

import { installEditorGeometry, pressKey, typeText } from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { TicketUploadsState } from "@/app/components/tasks/description/use-ticket-uploads";
import type { TicketDescriptionState } from "@/app/components/tasks/description/use-ticket-description";

interface EditorElement extends HTMLElement {
  readonly editor: Editor;
}

beforeAll(installEditorGeometry);

function savingState(): TicketDescriptionState {
  return {
    status: "saving",
    isEditing: true,
    draft: "Draft",
    base: "Saved",
    isDirty: true,
    errorCode: "",
    startEditing: vi.fn(),
    change: vi.fn(),
    save: vi.fn(),
    cancel: vi.fn(),
    takeLatest: () => "Saved",
  };
}

it("does not submit a description again while its save is pending", async () => {
  const state = savingState();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <DescriptionEditor
        state={state}
        label="Description"
        variant="page"
        features={{ isDisplayableImage: () => false }}
      />
    </I18nextProvider>,
  );
  const editor = (
    (await screen.findByRole("textbox", {
      name: "Description",
    })) as EditorElement
  ).editor;
  act(() => pressKey(editor, "Enter", { mod: true }));
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps the existing standalone controls usable and prevents conflict overwrite without permission", async () => {
  const state = { ...savingState(), status: "conflict" as const };
  const i18n = createI18n("en");
  const view = render(
    <I18nextProvider i18n={i18n}>
      <DescriptionActions state={state} isApple={false} />
      <DescriptionConflict
        onTakeLatest={state.takeLatest}
        onOverwrite={state.save}
      />
    </I18nextProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("tasks.description.save"),
    }),
  );
  expect(state.save).toHaveBeenCalledTimes(1);
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <DescriptionConflict
        canOverwrite={false}
        onTakeLatest={state.takeLatest}
        onOverwrite={state.save}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("button", {
      name: i18n.t("tasks.description.conflict.overwrite"),
    }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", {
      name: i18n.t("tasks.description.conflict.reload"),
    }),
  ).toBeEnabled();
});

describe.each(["de", "en"] as const)(
  "%s ticket description permission changes",
  (language) => {
    it("preserves a draft but stops editing and saving after write permission is revoked", async () => {
      const i18n = createI18n(language);
      const submit = vi.fn().mockResolvedValue({ ok: true });
      const uploads: TicketUploadsState = {
        progress: null,
        fileName: null,
        errorCode: null,
        upload: async () => [],
      };
      function Story(): React.ReactElement {
        const [canEdit, setCanEdit] = useState(true);
        return (
          <>
            <button type="button" onClick={() => setCanEdit(false)}>
              Revoke
            </button>
            <TicketDescription
              canEdit={canEdit}
              ticket={{ id: "ticket", key: "PAGE-1", description: "Saved" }}
              uploads={uploads}
            />
          </>
        );
      }
      const router = createMemoryRouter([
        { path: "/", element: <Story /> },
        { path: "/aufgaben", action: submit },
      ]);
      render(
        <I18nextProvider i18n={i18n}>
          <RouterProvider router={router} />
        </I18nextProvider>,
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: i18n.t("tasks.detail.editDescription"),
        }),
      );
      const element = await screen.findByRole("textbox", {
        name: i18n.t("tasks.description.editorLabel", { key: "PAGE-1" }),
      });
      const editor = (element as EditorElement).editor;
      act(() => {
        editor.commands.focus("end");
        typeText(editor, " draft");
      });
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
      await waitFor(() =>
        expect(element).toHaveAttribute("contenteditable", "false"),
      );
      expect(element).toHaveTextContent("Saved draft");
      expect(
        screen.getByRole("button", { name: i18n.t("tasks.description.save") }),
      ).toBeDisabled();
      act(() => pressKey(editor, "Enter", { mod: true }));
      expect(submit).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", {
          name: i18n.t("tasks.description.cancel"),
        }),
      );
      expect(await screen.findByText("Saved")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  },
);
