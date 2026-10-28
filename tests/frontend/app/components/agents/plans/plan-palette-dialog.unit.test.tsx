import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { PlanPaletteDialog } from "@/app/components/agents/plans/plan-palette-dialog";

import { i18n, renderTranslated } from "./plan-panel-fixture";

import type { AgentPlanSources, AgentPlanTask } from "@/definition/AgentPlan";
import type { PageAgentModel } from "@/definition/PageAgent";

type Kind = "agent" | "task" | "parameter" | "group";

function model(
  id: string,
  overrides: Partial<PageAgentModel> = {},
): PageAgentModel {
  return {
    id,
    name: `Model ${id}`,
    model: id,
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    provider: "openrouter",
    ...overrides,
  };
}

const TASK: AgentPlanTask = {
  id: "t1",
  key: "SYN-1",
  title: "Open work",
  type: "task",
  parentId: null,
  statusKey: "todo",
  statusName: "To Do",
  isDone: false,
  createdAt: "2026-01-01 08:00:00",
  updatedAt: "2026-01-01 08:00:00",
};

const SOURCES: AgentPlanSources = {
  agents: [],
  tasks: [TASK],
  models: [model("m1"), model("m2", { isManual: true, isFree: true })],
};

function renderDialog(
  kind: Kind,
  options: {
    readonly sources?: AgentPlanSources;
    readonly blocked?: string | null;
  } = {},
): {
  readonly onConfirm: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  renderTranslated(
    <>
      <button type="button" data-plan-palette-kind={kind}>
        Palette entry
      </button>
      <PlanPaletteDialog
        request={{ kind }}
        sources={options.sources ?? SOURCES}
        blocked={options.blocked ?? null}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </>,
  );
  return { onConfirm, onClose };
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("plans.palette.add") });
}

async function choose(label: string, option: string | RegExp): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("adds a group only with a non-blank name, trimmed", () => {
  const { onConfirm } = renderDialog("group");
  const dialog = screen.getByRole("dialog", {
    name: i18n.t("plans.palette.addTitle", {
      type: i18n.t("plans.nodeType.group"),
    }),
  });
  const name = screen.getByRole("textbox", {
    name: i18n.t("plans.groups.name"),
  });

  expect(dialog.textContent).toContain(i18n.t("plans.palette.configure.group"));
  expect(name.getAttribute("maxlength")).toBe("120");
  expect(addButton().hasAttribute("disabled")).toBe(true);
  fireEvent.change(name, { target: { value: "   " } });
  fireEvent.submit(name);
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: "  Review  " } });
  fireEvent.click(addButton());

  expect(onConfirm).toHaveBeenCalledWith("Review");
});

it("names an invalid parameter and adds only a valid parameter name", () => {
  const { onConfirm } = renderDialog("parameter");
  const name = screen.getByRole("textbox", {
    name: i18n.t("plans.parameterName"),
  });

  expect(name.getAttribute("maxlength")).toBe("64");
  expect(screen.queryByText(i18n.t("plans.validation.name"))).toBeNull();
  fireEvent.change(name, { target: { value: "9 bad name" } });
  expect(screen.getByText(i18n.t("plans.validation.name"))).toBeDefined();
  expect(addButton().hasAttribute("disabled")).toBe(true);
  fireEvent.change(name, { target: { value: "ticket" } });
  expect(screen.queryByText(i18n.t("plans.validation.name"))).toBeNull();
  fireEvent.click(addButton());

  expect(onConfirm).toHaveBeenCalledWith("ticket");
});

it("adds an agent only for a model of the sources and describes each model", async () => {
  const { onConfirm } = renderDialog("agent");
  const label = i18n.t("plans.palette.chooseAgent");

  expect(addButton().hasAttribute("disabled")).toBe(true);
  expect(screen.queryByText(i18n.t("plans.palette.noAgents"))).toBeNull();
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  const listbox = await screen.findByRole("listbox");
  expect(listbox.textContent).toContain(
    `${i18n.t("settings.agents.provider.openrouter")} · ${i18n.t("picaSettings.manual")} · ${i18n.t("settings.agents.freeBadge")}`,
  );
  fireEvent.click(screen.getByRole("option", { name: "Model m2" }));
  fireEvent.click(addButton());

  expect(onConfirm).toHaveBeenCalledWith("m2");
});

it("says that no agent model is available when the sources list none", () => {
  renderDialog("agent", { sources: { agents: [], tasks: [] } });

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.palette.noAgents"),
  );
  expect(addButton().hasAttribute("disabled")).toBe(true);
});

it("adds a ticket of the sources and says when there is none", async () => {
  const { onConfirm } = renderDialog("task");

  await choose(i18n.t("plans.ticketPicker.choose"), "SYN-1: Open work");
  fireEvent.click(addButton());

  expect(onConfirm).toHaveBeenCalledWith("t1");
});

it("says that the project has no tickets", () => {
  renderDialog("task", { sources: { agents: [], tasks: [] } });

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.palette.noTickets"),
  );
});

it("disables the reference and adding while the palette is blocked, and names why", () => {
  const { onConfirm } = renderDialog("group", {
    blocked: "Choose a workspace",
  });
  const name = screen.getByRole("textbox", {
    name: i18n.t("plans.groups.name"),
  });

  expect(name.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("Choose a workspace");
  fireEvent.submit(name);

  expect(onConfirm).not.toHaveBeenCalled();
  expect(addButton().hasAttribute("disabled")).toBe(true);
});

it("closes with Cancel and with Escape, returning the focus to the palette entry", () => {
  const { onClose } = renderDialog("group");

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(onClose).toHaveBeenCalledTimes(2);
});

it("moves the focus back to its palette entry when the dialog closes", async () => {
  const onClose = vi.fn();
  const view = renderTranslated(
    <>
      <button type="button" data-plan-palette-kind="group">
        Palette entry
      </button>
      <PlanPaletteDialog
        request={{ kind: "group" }}
        sources={SOURCES}
        blocked={null}
        onConfirm={vi.fn()}
        onClose={onClose}
      />
    </>,
  );

  view.rerender(
    <I18nextProvider i18n={i18n}>
      <>
        <button type="button" data-plan-palette-kind="group">
          Palette entry
        </button>
      </>
    </I18nextProvider>,
  );

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Palette entry" }),
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
});

function Closable(): React.ReactElement {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {isOpen ? (
        <PlanPaletteDialog
          request={{ kind: "group" }}
          sources={SOURCES}
          blocked={null}
          onConfirm={vi.fn()}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

it("does not return the focus to another opener when its palette entry is gone", async () => {
  renderTranslated(<Closable />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);

  fireEvent.click(
    await screen.findByRole("button", {
      name: i18n.t("settings.agents.cancel"),
    }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(document.activeElement).not.toBe(opener);
});
