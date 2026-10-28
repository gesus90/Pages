import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { planDropGroup } from "@/app/components/agents/plans/plan-layout";
import { insertPlanTemplate } from "@/app/components/agents/plans/plan-templates/plan-template-requests";
import { usePlanTemplateInsertion } from "@/app/components/agents/plans/plan-templates/use-plan-template-insertion";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import {
  agentStep,
  flowContext,
  graphActions,
  groupNode,
  planOf,
} from "../plan-flow-fixture";
import { parameterNode, savedTemplate } from "./template-fixture";

import type { PlanCanvasProps } from "@/app/components/agents/plans/plan-flow-context";
import type { AgentPlanNodeTemplate } from "@/definition/AgentPlanNodeTemplate";

const DROP_POINT = { x: 320, y: 160 };

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ screenToFlowPosition: () => DROP_POINT }),
}));
vi.mock(
  "@/app/components/agents/plans/plan-templates/plan-template-requests",
  () => ({ insertPlanTemplate: vi.fn() }),
);
vi.mock("@/definition/AgentPlanGraph", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planExecutionIssues: vi.fn(() => []),
}));
vi.mock(
  "@/app/components/agents/plans/plan-layout",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    planDropGroup: vi.fn(() => null),
  }),
);

const AGENT_TEMPLATE = savedTemplate(agentStep("source"), {
  id: "agent-template",
  name: "Reviewer",
});

function Harness(props: {
  readonly canvas: PlanCanvasProps;
  readonly blocked: string | null;
  readonly template: AgentPlanNodeTemplate;
}): React.ReactElement {
  const insertion = usePlanTemplateInsertion(props.canvas, props.blocked);
  return (
    <>
      <button
        type="button"
        draggable
        onClick={() => insertion.activate(props.template)}
        onDragStart={(event) => insertion.dragStart(event, props.template)}
        onDragEnd={insertion.dragEnd}
      >
        Template
      </button>
      <div
        data-testid="canvas"
        onDragOver={insertion.dragOver}
        onDrop={insertion.drop}
      />
      <button type="button" onClick={insertion.dismiss}>
        Dismiss
      </button>
      <output>
        {JSON.stringify({
          pendingId: insertion.pendingId,
          outcome: insertion.outcome,
        })}
      </output>
    </>
  );
}

interface Rendered {
  readonly canvas: PlanCanvasProps;
  readonly rerender: (blocked: string | null) => void;
}

function show(
  options: {
    readonly canvas?: PlanCanvasProps;
    readonly blocked?: string | null;
    readonly template?: AgentPlanNodeTemplate;
  } = {},
): Rendered {
  const canvas =
    options.canvas ??
    flowContext({
      planId: "plan",
      graph: graphActions({ insertTemplate: vi.fn(() => "copy") }),
    });
  const template = options.template ?? AGENT_TEMPLATE;
  const view = render(
    <Harness
      canvas={canvas}
      blocked={options.blocked ?? null}
      template={template}
    />,
  );
  return {
    canvas,
    rerender: (blocked) =>
      view.rerender(
        <Harness canvas={canvas} blocked={blocked} template={template} />,
      ),
  };
}

function state(): {
  readonly pendingId: string | null;
  readonly outcome: unknown;
} {
  const text = screen.getByRole("status").textContent;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("outcome" in parsed))
    throw new Error("Expected the insertion state");
  const pendingId = "pendingId" in parsed ? parsed.pendingId : null;
  return {
    pendingId: typeof pendingId === "string" ? pendingId : null,
    outcome: parsed.outcome,
  };
}

function transfer(): {
  readonly setData: ReturnType<typeof vi.fn>;
  effectAllowed: string;
  dropEffect: string;
} {
  return { setData: vi.fn(), effectAllowed: "none", dropEffect: "none" };
}

function source(): HTMLElement {
  return screen.getByRole("button", { name: "Template" });
}

function canvasArea(): HTMLElement {
  return screen.getByTestId("canvas");
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(insertPlanTemplate).mockResolvedValue({
    ok: true,
    value: agentStep("copy"),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it("inserts a copy on click and lists the inputs it still needs", async () => {
  vi.mocked(planExecutionIssues).mockReturnValue([
    { nodeId: "copy", port: "ticket", reason: "required" },
    { nodeId: "copy", port: "ticket", reason: "resultMissing" },
    { nodeId: "copy", port: "notes", reason: "type" },
    { nodeId: "copy", port: null, reason: "required" },
    { nodeId: "other", port: "topic", reason: "required" },
    { nodeId: null, port: "global", reason: "required" },
  ]);
  const { canvas } = show();
  fireEvent.click(source());
  expect(state().pendingId).toBe("agent-template");
  await settle();
  expect(insertPlanTemplate).toHaveBeenCalledWith(
    { planId: "plan", workspaceId: "workspace" },
    "agent-template",
  );
  expect(canvas.graph.insertTemplate).toHaveBeenCalledWith(
    agentStep("copy"),
    undefined,
    undefined,
  );
  expect(state()).toEqual({
    pendingId: null,
    outcome: { kind: "inserted", name: "Reviewer", openInputs: ["ticket"] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(state().outcome).toBeNull();
});

it("names the reason of a refused insertion for an unsaved plan", async () => {
  vi.mocked(insertPlanTemplate).mockResolvedValueOnce({
    ok: false,
    error: "template_missing",
  });
  const canvas = flowContext({ graph: graphActions() });
  show({ canvas });
  fireEvent.click(source());
  await settle();
  expect(insertPlanTemplate).toHaveBeenCalledWith(
    { planId: "", workspaceId: "workspace" },
    "agent-template",
  );
  expect(state().outcome).toEqual({
    kind: "failed",
    name: "Reviewer",
    error: "template_missing",
  });
  expect(canvas.graph.insertTemplate).not.toHaveBeenCalled();
});

it("tells nothing when the draft refuses the copy", async () => {
  const canvas = flowContext({
    graph: graphActions({ insertTemplate: vi.fn(() => null) }),
  });
  show({ canvas });
  fireEvent.click(source());
  await settle();
  expect(canvas.graph.insertTemplate).toHaveBeenCalledOnce();
  expect(state().outcome).toBeNull();
});

it("ignores clicks while blocked or while an insertion is pending", async () => {
  const { rerender } = show({ blocked: "Read only" });
  fireEvent.click(source());
  expect(insertPlanTemplate).not.toHaveBeenCalled();
  rerender(null);
  fireEvent.click(source());
  fireEvent.click(source());
  await settle();
  expect(insertPlanTemplate).toHaveBeenCalledOnce();
});

it("places a dropped agent copy in the group under the pointer", async () => {
  const group = groupNode("group", []);
  vi.mocked(planDropGroup).mockReturnValueOnce(group);
  const canvas = flowContext({
    draft: planOf([group]),
    graph: graphActions({ insertTemplate: vi.fn(() => "copy") }),
  });
  show({ canvas });
  const loaded = transfer();
  fireEvent.dragStart(source(), { dataTransfer: loaded });
  expect(loaded.setData).toHaveBeenCalledWith(
    "application/x-pages-plan-template",
    "agent-template",
  );
  expect(loaded.effectAllowed).toBe("copy");
  expect(fireEvent.dragOver(canvasArea(), { dataTransfer: loaded })).toBe(
    false,
  );
  expect(loaded.dropEffect).toBe("copy");
  fireEvent.drop(canvasArea(), { dataTransfer: loaded });
  await settle();
  expect(planDropGroup).toHaveBeenCalledWith(
    canvas.draft,
    DROP_POINT,
    canvas.sources,
    null,
  );
  expect(canvas.graph.insertTemplate).toHaveBeenCalledWith(
    agentStep("copy"),
    DROP_POINT,
    "group",
  );
  // The drag ended without a click; the next click inserts once more.
  fireEvent.click(source());
  expect(insertPlanTemplate).toHaveBeenCalledOnce();
  fireEvent.click(source());
  await settle();
  expect(insertPlanTemplate).toHaveBeenCalledTimes(2);
});

it("drops a copy that is no agent outside every group", async () => {
  vi.mocked(insertPlanTemplate).mockResolvedValueOnce({
    ok: true,
    value: parameterNode({ id: "copy" }),
  });
  const { canvas } = show({ template: savedTemplate() });
  fireEvent.dragStart(source(), { dataTransfer: transfer() });
  fireEvent.drop(canvasArea(), { dataTransfer: transfer() });
  await settle();
  expect(planDropGroup).not.toHaveBeenCalled();
  expect(canvas.graph.insertTemplate).toHaveBeenCalledWith(
    parameterNode({ id: "copy" }),
    DROP_POINT,
    undefined,
  );
});

it("allows a click again on the task after a drag ended", () => {
  vi.useFakeTimers();
  show();
  fireEvent.dragStart(source(), { dataTransfer: transfer() });
  fireEvent.dragEnd(source());
  act(() => {
    vi.runAllTimers();
  });
  fireEvent.click(source());
  expect(insertPlanTemplate).toHaveBeenCalledOnce();
});

it("refuses drags while blocked or pending and drops nothing without a drag", async () => {
  const { rerender } = show({ blocked: "Read only" });
  const loaded = transfer();
  expect(fireEvent.dragStart(source(), { dataTransfer: loaded })).toBe(false);
  expect(loaded.setData).not.toHaveBeenCalled();
  expect(fireEvent.dragOver(canvasArea(), { dataTransfer: loaded })).toBe(true);
  expect(fireEvent.drop(canvasArea(), { dataTransfer: loaded })).toBe(true);
  rerender(null);
  fireEvent.dragStart(source(), { dataTransfer: loaded });
  rerender("Read only");
  expect(fireEvent.dragOver(canvasArea(), { dataTransfer: loaded })).toBe(true);
  expect(fireEvent.drop(canvasArea(), { dataTransfer: loaded })).toBe(true);
  rerender(null);
  fireEvent.dragEnd(source());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(source());
  expect(fireEvent.dragStart(source(), { dataTransfer: transfer() })).toBe(
    false,
  );
  await settle();
  expect(insertPlanTemplate).toHaveBeenCalledOnce();
});
