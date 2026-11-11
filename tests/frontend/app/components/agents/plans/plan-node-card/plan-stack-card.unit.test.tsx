import {
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanStackCard } from "@/app/components/agents/plans/plan-node-card/plan-stack-card";
import {
  emptyPlanStack,
  PLAN_STACK_ENTRY_COUNT,
} from "@/definition/AgentPlanStack";

import {
  runStep,
  syntheticRun,
  syntheticSession,
} from "../../page72-run-fixture";
import { SOURCES } from "../../page61-plan-fixture";
import {
  agentStep,
  flow,
  flowContext,
  graphActions,
  i18n,
  loopNode,
  planOf,
  renderInFlow,
} from "../plan-flow-fixture";

import type * as PlanAssetUpload from "@/app/lib/plan-asset-upload";
import type { PlanFlowContextValue } from "@/app/components/agents/plans/plan-flow-context";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  AgentPlanStack,
  AgentPlanStackEntry,
  AgentPlanStackRun,
} from "@/definition/AgentPlanStack";

const uploads = vi.hoisted(() => ({ uploadPlanAsset: vi.fn() }));

vi.mock("@/app/lib/plan-asset-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof PlanAssetUpload>()),
  uploadPlanAsset: uploads.uploadPlanAsset,
}));
vi.mock("@/app/lib/random-uuid", () => ({
  createRandomUuid: () => "new-entry",
}));

const EMPTY = emptyPlanStack("stack", "Orders", { x: 0, y: 0 });

function ticketEntry(id: string, taskId: string): AgentPlanStackEntry {
  return { id, type: "task", taskId };
}

function stackWith(entries: readonly AgentPlanStackEntry[]): AgentPlanStack {
  return { ...EMPTY, entries };
}

function stackRun(
  deliveredIds: readonly string[],
  overrides: Partial<AgentPlanStackRun> = {},
): AgentPlanStackRun {
  return {
    id: "stack",
    name: "Orders",
    total: 2,
    deliveries: deliveredIds.map((entryId, index) => ({
      entryId,
      position: index + 1,
      loopId: null,
      iteration: null,
      at: "2026-11-10T10:00:00.000Z",
    })),
    emptyTriggers: 0,
    last: deliveredIds.length > 0 ? "entry" : null,
    ...overrides,
  };
}

interface CardOptions {
  readonly stack?: AgentPlanStack;
  readonly nodes?: readonly AgentPlanNode[];
  readonly edges?: AgentPlanInput["edges"];
  readonly stacks?: readonly AgentPlanStackRun[];
  readonly steps?: readonly AgentPlanStepResult[];
  readonly hasRun?: boolean;
  readonly isDropTarget?: boolean;
  readonly context?: Partial<PlanFlowContextValue>;
}

function renderCard(options: CardOptions = {}): {
  context: PlanFlowContextValue;
  root: HTMLElement;
  draft: AgentPlanInput;
} {
  const stack = options.stack ?? EMPTY;
  const draft: AgentPlanInput = {
    ...planOf([stack, ...(options.nodes ?? [])], options.edges ?? []),
    projectId: "project-1",
  };
  const hasRun = options.hasRun ?? options.stacks !== undefined;
  const run = hasRun
    ? {
        ...syntheticRun(),
        steps: options.steps ?? [],
        stacks: options.stacks,
      }
    : null;
  const context = flowContext({
    draft,
    sources: SOURCES,
    run,
    ...options.context,
  });
  const { container } = renderInFlow(
    <PlanStackCard
      stack={stack}
      hasRun={hasRun}
      isDropTarget={options.isDropTarget ?? false}
    />,
    context,
  );
  const root = container.querySelector<HTMLElement>("[data-plan-stack]");
  if (!root) throw new Error("The stack card is missing.");
  return { context, root, draft };
}

beforeEach(() => {
  uploads.uploadPlanAsset.mockReset();
});

it("shows an empty stack with its summary, ports and fixed order, and marks it empty", () => {
  const { root } = renderCard();

  expect(root.dataset.planStack).toBe("stack");
  expect(screen.getByRole("article", { name: "Orders" }).textContent).toContain(
    i18n.t("plans.stack.caption"),
  );
  expect(root.querySelector("[data-plan-stack-badge]")?.textContent).toBe(
    i18n.t("plans.stack.state.empty"),
  );
  expect(root.querySelector("[data-plan-stack-summary]")?.textContent).toBe(
    i18n.t("plans.stack.summary", { count: 0, delivered: 0, remaining: 0 }),
  );
  expect(root.textContent).toContain(i18n.t("plans.stack.order"));
  expect(root.textContent).toContain(i18n.t("plans.stack.reset"));
  expect(root.querySelector("[data-plan-stack-outcome]")).toBeNull();
  expect(root.querySelector("[data-plan-stack-scope]")).toBeNull();
  const outputs = root.querySelectorAll<HTMLElement>(
    "[data-plan-stack-output]",
  );
  expect(outputs).toHaveLength(2);
  expect(outputs[0]?.textContent).toContain(i18n.t("plans.stack.noContent"));
  expect(outputs[1]?.textContent).toContain(
    i18n.t("plans.stack.countValue", { count: 0 }),
  );
});

it("falls back to the type name for a stack without a name", () => {
  renderCard({ stack: { ...EMPTY, name: "  " } });
  expect(
    screen.getByRole("article", { name: i18n.t("plans.nodeType.stack") }),
  ).toBeDefined();
});

it("shows no badge on a stack with entries until a run is shown", () => {
  const { root } = renderCard({
    stack: stackWith([ticketEntry("e1", "1"), ticketEntry("e2", "2")]),
  });
  expect(root.querySelector("[data-plan-stack-badge]")).toBeNull();
  expect(root.querySelector("[data-plan-stack-summary]")?.textContent).toBe(
    i18n.t("plans.stack.summary", { count: 2, delivered: 0, remaining: 2 }),
  );
  expect(
    root.querySelector("[data-plan-stack-output='count']")?.textContent,
  ).toContain(i18n.t("plans.stack.countValue", { count: 2 }));
});

it("selects the stack and opens its editor from the edit button", () => {
  const onEdit = vi.fn();
  const { context } = renderCard({ context: { onEdit } });

  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Orders" }),
    }),
  );

  expect(context.graph.select).toHaveBeenCalledWith("stack");
  expect(onEdit).toHaveBeenCalledWith("stack");
});

it("only selects the stack when the canvas has no editor to open", () => {
  const { context } = renderCard({ context: { onEdit: undefined } });
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Orders" }),
    }),
  );
  expect(context.graph.select).toHaveBeenCalledWith("stack");
});

it("shows the progress of the shown run and the entry handed over last as content", () => {
  const { root } = renderCard({
    stack: stackWith([ticketEntry("e1", "1"), ticketEntry("e2", "2")]),
    stacks: [stackRun(["e1"])],
  });

  expect(root.querySelector("[data-plan-stack-badge]")?.textContent).toBe(
    i18n.t("plans.stack.progress", { delivered: 1, total: 2 }),
  );
  expect(root.querySelector("[data-plan-stack-summary]")?.textContent).toBe(
    i18n.t("plans.stack.summary", { count: 2, delivered: 1, remaining: 1 }),
  );
  expect(
    root.querySelector("[data-plan-stack-output='content']")?.textContent,
  ).toContain("SYN-1: Open work");
});

it("marks a stack whose entries were all handed over as used up", () => {
  const { root } = renderCard({
    stack: stackWith([ticketEntry("e1", "1")]),
    stacks: [stackRun(["e1"], { total: 1 })],
  });
  expect(root.querySelector("[data-plan-stack-badge]")?.textContent).toBe(
    i18n.t("plans.stack.state.used"),
  );
});

const PROCESSING_PLAN = {
  stack: stackWith([ticketEntry("e1", "1")]),
  nodes: [agentStep("worker")],
  edges: [flow("stack", "worker")],
  stacks: [stackRun(["e1"], { total: 1 })],
};

function outcomeNote(root: HTMLElement): HTMLElement {
  const note = root.querySelector<HTMLElement>("[data-plan-stack-outcome]");
  if (!note) throw new Error("The outcome note is missing.");
  return note;
}

it("shows no outcome while no entry was handed over", () => {
  const { root } = renderCard({
    ...PROCESSING_PLAN,
    stacks: [stackRun([], { total: 1 })],
    steps: [runStep("worker", { status: "running" })],
  });
  expect(root.querySelector("[data-plan-stack-outcome]")).toBeNull();
});

it("notes that the processing is running with a spinning sign", () => {
  const { root } = renderCard({
    ...PROCESSING_PLAN,
    steps: [runStep("worker", { status: "running" })],
  });
  const note = outcomeNote(root);
  expect(note.dataset.planStackOutcome).toBe("processing");
  expect(note.textContent).toBe(i18n.t("plans.stack.outcome.processing"));
  expect(note.querySelector("svg")?.getAttribute("class")).toContain(
    "animate-spin",
  );
});

it("turns the card to success once every handed over entry was processed", () => {
  const { root } = renderCard({
    ...PROCESSING_PLAN,
    steps: [runStep("worker", { status: "succeeded" })],
  });
  const note = outcomeNote(root);
  expect(note.dataset.planStackOutcome).toBe("succeeded");
  expect(note.textContent).toBe(i18n.t("plans.stack.outcome.succeeded"));
  expect(note.querySelector("svg")?.getAttribute("class")).not.toContain(
    "animate-spin",
  );
  expect(screen.getByRole("article", { name: "Orders" }).className).toContain(
    "success",
  );
});

it("warns when a processing participant succeeded with an open report", () => {
  const { root } = renderCard({
    ...PROCESSING_PLAN,
    steps: [
      runStep("worker", { status: "succeeded", session: syntheticSession() }),
    ],
  });
  const note = outcomeNote(root);
  expect(note.dataset.planStackOutcome).toBe("open");
  expect(note.textContent).toBe(i18n.t("plans.stack.outcome.open"));
  expect(screen.getByRole("article", { name: "Orders" }).className).toContain(
    "warning",
  );
});

it("marks the processing as failed when a participant failed", () => {
  const { root } = renderCard({
    ...PROCESSING_PLAN,
    steps: [runStep("worker", { status: "failed" })],
  });
  const note = outcomeNote(root);
  expect(note.dataset.planStackOutcome).toBe("failed");
  expect(note.textContent).toBe(i18n.t("plans.stack.outcome.failed"));
  expect(screen.getByRole("article", { name: "Orders" }).className).toContain(
    "destructive",
  );
});

it("keeps the type colors of the card for an outcome that is still being processed", () => {
  renderCard({
    ...PROCESSING_PLAN,
    steps: [runStep("worker", { status: "running" })],
  });
  const classes = screen.getByRole("article", { name: "Orders" }).className;
  expect(classes).not.toContain("success");
  expect(classes).not.toContain("destructive");
});

it("names the loop whose iterations trigger the stack", () => {
  const member = agentStep("member");
  const { root } = renderCard({
    nodes: [loopNode("loop", [member])],
    edges: [flow("stack", "member")],
  });
  expect(root.querySelector("[data-plan-stack-scope]")?.textContent).toBe(
    i18n.t("plans.stack.loopScope", { name: "Loop loop" }),
  );
});

it("adds the chosen ticket as the last entry of the stack", () => {
  const { context, root, draft } = renderCard({
    stack: stackWith([ticketEntry("e1", "1")]),
  });
  fireEvent.click(
    within(root).getByRole("combobox", {
      name: i18n.t("plans.stack.addTicket"),
    }),
  );
  fireEvent.click(screen.getByRole("option", { name: /SYN-4/u }));

  expect(context.graph.edit).toHaveBeenCalledTimes(1);
  const [apply] = vi.mocked(context.graph.edit).mock.calls[0] ?? [];
  const edited = apply?.(draft);
  const stack = edited?.nodes.find((node) => node.id === "stack");
  expect(stack?.type === "stack" ? stack.entries : []).toEqual([
    ticketEntry("e1", "1"),
    ticketEntry("new-entry", "4"),
  ]);
});

it("offers neither a ticket nor a file to a plan that cannot be edited", () => {
  const { root } = renderCard({ context: { canEdit: false } });
  expect(
    within(root).queryByRole("combobox", {
      name: i18n.t("plans.stack.addTicket"),
    }),
  ).toBeNull();
  expect(root.querySelector("[data-plan-stack-files]")).toBeNull();
});

const FULL_STACK = stackWith(
  Array.from({ length: PLAN_STACK_ENTRY_COUNT }, (_, index) =>
    ticketEntry(`e${index}`, "1"),
  ),
);

it("offers no further ticket and takes no dropped file once the stack is full", () => {
  const { root } = renderCard({ stack: FULL_STACK });
  expect(
    within(root).queryByRole("combobox", {
      name: i18n.t("plans.stack.addTicket"),
    }),
  ).toBeNull();
  expect(root.querySelector("[data-plan-stack-files]")).toBeNull();

  const event = createEvent.dragOver(root, {
    dataTransfer: { types: ["Files"], dropEffect: "none" },
  });
  fireEvent(root, event);
  expect(event.defaultPrevented).toBe(false);
});

it("explains the drop target while a card is dragged over the stack", () => {
  const { root } = renderCard({ isDropTarget: true });
  expect(root.className).toContain("ring-2");
  expect(
    within(root).getByText(i18n.t("plans.stack.dropHere")).getAttribute("role"),
  ).toBe("status");
});

it("has no drop notice when nothing is dragged over the stack", () => {
  const { root } = renderCard();
  expect(root.className).not.toContain("ring-2");
  expect(within(root).queryByText(i18n.t("plans.stack.dropHere"))).toBeNull();
});

it("offers the file choice and shows the drop state of a file dragged over", () => {
  const { root } = renderCard();
  const row = root.querySelector<HTMLElement>("[data-plan-stack-files]");
  expect(row?.dataset.planStackFiles).toBe("idle");
  expect(row?.textContent).toBe(i18n.t("plans.asset.stackDrop"));

  const event = createEvent.dragOver(root, {
    dataTransfer: { types: ["Files"], dropEffect: "none" },
  });
  fireEvent(root, event);

  expect(event.defaultPrevented).toBe(true);
  expect(
    root.querySelector<HTMLElement>("[data-plan-stack-files]")?.textContent,
  ).toBe(i18n.t("plans.asset.dropHere"));
});

it("appends a dropped file as the last entry of the stack", async () => {
  const stored = {
    assetId: "stored-1",
    fileName: "brief.pdf",
    mediaType: "application/pdf",
    kind: "document" as const,
    size: 10,
    digest: "c".repeat(64),
  };
  uploads.uploadPlanAsset.mockResolvedValue(stored);
  const { context, root, draft } = renderCard({
    stack: stackWith([ticketEntry("e1", "1")]),
  });
  const file = new File(["x"], "brief.pdf", { type: "application/pdf" });

  fireEvent.drop(root, { dataTransfer: { types: ["Files"], files: [file] } });

  await waitFor(() => expect(context.graph.edit).toHaveBeenCalledTimes(1));
  expect(uploads.uploadPlanAsset).toHaveBeenCalledWith(
    "project-1",
    file,
    expect.any(Function),
  );
  const [apply] = vi.mocked(context.graph.edit).mock.calls[0] ?? [];
  const stack = apply?.(draft).nodes.find((node) => node.id === "stack");
  expect(stack?.type === "stack" ? stack.entries : []).toEqual([
    ticketEntry("e1", "1"),
    { id: "new-entry", type: "asset", file: stored },
  ]);
});

it("keeps the stack unchanged and names the reason when a dropped file is refused", async () => {
  const { PlanAssetUploadError } = await import("@/app/lib/plan-asset-upload");
  uploads.uploadPlanAsset.mockRejectedValue(
    new PlanAssetUploadError("network"),
  );
  const graph = graphActions();
  const { root } = renderCard({ context: { graph } });

  fireEvent.drop(root, {
    dataTransfer: {
      types: ["Files"],
      files: [new File(["x"], "brief.pdf")],
    },
  });

  await waitFor(() =>
    expect(
      root.querySelector<HTMLElement>("[data-plan-stack-files]")?.dataset
        .planStackFiles,
    ).toBe("failed"),
  );
  expect(graph.edit).not.toHaveBeenCalled();
});
