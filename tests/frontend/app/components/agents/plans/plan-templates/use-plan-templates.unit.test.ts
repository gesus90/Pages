import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { usePlanTemplateInsertion } from "@/app/components/agents/plans/plan-templates/use-plan-template-insertion";
import { usePlanTemplateList } from "@/app/components/agents/plans/plan-templates/use-plan-template-list";
import { usePlanTemplates } from "@/app/components/agents/plans/plan-templates/use-plan-templates";

import {
  agentStep,
  flowContext,
  groupNode,
  planOf,
} from "../plan-flow-fixture";
import { parameterNode, savedTemplate } from "./template-fixture";

import type { RenderHookResult } from "@testing-library/react";
import type { PlanCanvasProps } from "@/app/components/agents/plans/plan-flow-context";
import type { PlanTemplateList } from "@/app/components/agents/plans/plan-templates/use-plan-template-list";
import type { PlanTemplates } from "@/app/components/agents/plans/plan-templates/use-plan-templates";

vi.mock(
  "@/app/components/agents/plans/plan-templates/use-plan-template-list",
  () => ({ usePlanTemplateList: vi.fn() }),
);
vi.mock(
  "@/app/components/agents/plans/plan-templates/use-plan-template-insertion",
  () => ({ usePlanTemplateInsertion: vi.fn() }),
);

const MEMBER = agentStep("member");
const PARAMETER = parameterNode();
const DRAFT = planOf([
  PARAMETER,
  groupNode("group", [MEMBER]),
  { id: "start", type: "start", x: 0, y: 0 },
]);

function list(status: PlanTemplateList["status"]): PlanTemplateList {
  return { status, templates: [], savedId: null, load: vi.fn(), add: vi.fn() };
}

function mount(
  canvas: PlanCanvasProps = flowContext({ draft: DRAFT }),
  templates: PlanTemplateList = list("idle"),
): RenderHookResult<PlanTemplates, unknown> {
  vi.mocked(usePlanTemplateList).mockReturnValue(templates);
  return renderHook(() => usePlanTemplates(canvas, null));
}

beforeEach(() => {
  vi.resetAllMocks();
});

it("reads the templates of the draft's workspace and inserts with its block", () => {
  const canvas = flowContext({ draft: DRAFT });
  vi.mocked(usePlanTemplateList).mockReturnValue(list("ready"));
  renderHook(() => usePlanTemplates(canvas, "Read only"));
  expect(usePlanTemplateList).toHaveBeenCalledWith("workspace");
  expect(usePlanTemplateInsertion).toHaveBeenCalledWith(canvas, "Read only");
});

it("opens the save dialog with a copy of a node or group member", () => {
  const { result } = mount();
  expect(result.current.saving).toBeNull();
  act(() => result.current.requestSave("member"));
  expect(result.current.saving).toEqual(MEMBER);
  expect(result.current.saving).not.toBe(MEMBER);
  act(() => result.current.requestSave("parameter"));
  expect(result.current.saving).toEqual(PARAMETER);
  act(() => result.current.closeSave());
  expect(result.current.saving).toBeNull();
});

it("keeps the dialog closed for nodes without templates, missing nodes and read-only plans", () => {
  const { result } = mount();
  act(() => result.current.requestSave("start"));
  act(() => result.current.requestSave("missing"));
  expect(result.current.saving).toBeNull();
  const readOnly = mount(flowContext({ draft: DRAFT, canEdit: false }));
  act(() => readOnly.result.current.requestSave("parameter"));
  expect(readOnly.result.current.saving).toBeNull();
});

it("shows a saved template on top of a list it loads first", () => {
  const templates = list("idle");
  const { result } = mount(undefined, templates);
  act(() => result.current.view.toggle());
  act(() => result.current.requestSave("parameter"));
  const template = savedTemplate();
  act(() => result.current.saved(template));
  expect(templates.load).toHaveBeenCalledOnce();
  expect(templates.add).toHaveBeenCalledWith(template);
  expect(result.current.saving).toBeNull();
  expect(result.current.view.isOpen).toBe(true);
  expect(result.current.view.tab).toBe("templates");
});

it("does not read a loaded list again after a save", () => {
  const templates = list("ready");
  const { result } = mount(undefined, templates);
  act(() => result.current.saved(savedTemplate()));
  expect(templates.load).not.toHaveBeenCalled();
  expect(templates.add).toHaveBeenCalledOnce();
});
