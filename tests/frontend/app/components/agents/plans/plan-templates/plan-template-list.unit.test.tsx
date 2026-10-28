import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanTemplateList } from "@/app/components/agents/plans/plan-templates/plan-template-list";
import { createI18n } from "@/app/lib/i18n";

import { flowContext, groupNode, agentStep } from "../plan-flow-fixture";
import { parameterNode, savedTemplate } from "./template-fixture";

import type { RenderResult } from "@testing-library/react";
import type { PlanCanvasProps } from "@/app/components/agents/plans/plan-flow-context";
import type { PlanTemplateList as PlanTemplateListState } from "@/app/components/agents/plans/plan-templates/use-plan-template-list";
import type {
  PlanTemplateInsertion,
  PlanTemplateOutcome,
} from "@/app/components/agents/plans/plan-templates/use-plan-template-insertion";

const i18n = createI18n("en");
const PARAMETER = savedTemplate(parameterNode(), { id: "topic" });
const GROUP = savedTemplate(groupNode("group", [agentStep("member")]), {
  id: "team",
  name: "Team review",
  isShared: true,
});

function listState(
  overrides: Partial<PlanTemplateListState> = {},
): PlanTemplateListState {
  return {
    status: "ready",
    templates: [],
    savedId: null,
    load: vi.fn(),
    add: vi.fn(),
    ...overrides,
  };
}

function insertionState(
  overrides: Partial<PlanTemplateInsertion> = {},
): PlanTemplateInsertion {
  return {
    pendingId: null,
    outcome: null,
    activate: vi.fn(),
    dragStart: vi.fn(),
    dragEnd: vi.fn(),
    dragOver: vi.fn(),
    drop: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

function show(
  list: PlanTemplateListState,
  insertion: PlanTemplateInsertion = insertionState(),
  blocked: string | null = null,
): RenderResult {
  const canvas: PlanCanvasProps = flowContext();
  return render(
    <I18nextProvider i18n={i18n}>
      <PlanTemplateList
        canvas={canvas}
        list={list}
        insertion={insertion}
        blocked={blocked}
      />
    </I18nextProvider>,
  );
}

function outcome(value: PlanTemplateOutcome): PlanTemplateInsertion {
  return insertionState({ outcome: value });
}

beforeEach(() => {
  // jsdom has no CSS namespace; template identifiers here need no escaping.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});

it("loads an idle list when shown and says that it is loading", () => {
  const list = listState({ status: "idle" });
  show(list);
  expect(list.load).toHaveBeenCalledOnce();
  expect(screen.getByRole("status").textContent).toBe("Loading templates …");
  expect(screen.queryByRole("list")).toBeNull();
});

it("offers to load a failed list again", () => {
  const list = listState({ status: "failed" });
  show(list);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("The templates could not be loaded.");
  fireEvent.click(within(alert).getByRole("button", { name: "Load again" }));
  expect(list.load).toHaveBeenCalledOnce();
});

it("says honestly that there are no templates yet", () => {
  show(listState());
  expect(screen.getByText(/^No templates yet\./u)).toBeTruthy();
});

it("lists templates with their type, team and configuration, and focuses the saved one", () => {
  show(listState({ templates: [PARAMETER, GROUP], savedId: "team" }));
  const list = screen.getByRole("list", { name: "Saved templates" });
  const rows = within(list).getAllByRole("button");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain(
    `${i18n.t("plans.nodeType.parameter")} · ${i18n.t("plans.valueTypes.string")} · Hello`,
  );
  expect(rows[1]?.textContent).toContain(
    `${i18n.t("plans.nodeType.group")} · Team · 1 agent`,
  );
  expect(rows[1]?.className).toContain("border-plan-group/70");
  expect(rows[0]?.className).not.toContain("border-plan-parameter/70");
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[0]?.getAttribute("aria-disabled")).toBe("false");
  expect(rows[0]?.getAttribute("draggable")).toBe("true");
});

it("inserts a template by click and starts and ends its drag", () => {
  const insertion = insertionState();
  show(listState({ templates: [PARAMETER] }), insertion);
  const row = screen.getByRole("button", { name: "Insert template “Topic”" });
  fireEvent.click(row);
  expect(insertion.activate).toHaveBeenCalledWith(PARAMETER);
  fireEvent.dragStart(row);
  expect(insertion.dragStart).toHaveBeenCalledWith(
    expect.anything(),
    PARAMETER,
  );
  fireEvent.dragEnd(row);
  expect(insertion.dragEnd).toHaveBeenCalledOnce();
});

it("locks every row while one is inserted or the palette is blocked", () => {
  show(
    listState({ templates: [PARAMETER, GROUP] }),
    insertionState({ pendingId: "topic" }),
  );
  const [pending, other] = screen.getAllByRole("button");
  expect(pending?.getAttribute("aria-busy")).toBe("true");
  expect(other?.getAttribute("aria-busy")).toBe("false");
  expect(other?.getAttribute("aria-disabled")).toBe("true");
  expect(other?.getAttribute("draggable")).toBe("false");
});

it("names the block of a read-only plan in the row's description", () => {
  show(listState({ templates: [PARAMETER] }), insertionState(), "Read only");
  const row = screen.getByRole("button");
  expect(row.getAttribute("aria-disabled")).toBe("true");
  fireEvent.focus(row);
  expect(document.body.textContent).toContain("Read only");
});

it("tells what an insertion led to and closes the notice", () => {
  const inserted = outcome({ kind: "inserted", name: "Topic", openInputs: [] });
  const view = show(listState(), inserted);
  expect(screen.getByRole("status").textContent).toBe("“Topic” inserted.");
  fireEvent.click(screen.getByRole("button", { name: "Close notice" }));
  expect(inserted.dismiss).toHaveBeenCalledOnce();
  view.unmount();
  show(
    listState(),
    outcome({ kind: "inserted", name: "Topic", openInputs: ["a", "b"] }),
  );
  expect(screen.getByRole("status").textContent).toBe(
    "“Topic” inserted. To complete: a, b.",
  );
});

it("names why an insertion failed", () => {
  show(
    listState(),
    outcome({ kind: "failed", name: "Topic", error: "name_taken" }),
  );
  expect(screen.getByRole("alert").textContent).toBe(
    `“Topic” was not inserted: ${i18n.t("settings.agents.error.name_taken")}`,
  );
});
