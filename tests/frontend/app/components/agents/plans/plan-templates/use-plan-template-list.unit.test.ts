import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { fetchPlanTemplates } from "@/app/components/agents/plans/plan-templates/plan-template-requests";
import { usePlanTemplateList } from "@/app/components/agents/plans/plan-templates/use-plan-template-list";

import { parameterNode, savedTemplate } from "./template-fixture";

vi.mock(
  "@/app/components/agents/plans/plan-templates/plan-template-requests",
  () => ({ fetchPlanTemplates: vi.fn() }),
);

beforeEach(() => {
  vi.resetAllMocks();
});

const FIRST = savedTemplate(parameterNode(), { id: "first", name: "First" });
const SECOND = savedTemplate(parameterNode(), { id: "second", name: "Second" });

it("stays idle until loaded and then lists the workspace's templates", async () => {
  vi.mocked(fetchPlanTemplates).mockResolvedValueOnce([FIRST]);
  const { result } = renderHook(() => usePlanTemplateList("workspace"));
  expect(result.current.status).toBe("idle");
  expect(result.current.templates).toEqual([]);
  act(() => result.current.load());
  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.templates).toEqual([FIRST]);
  expect(fetchPlanTemplates).toHaveBeenCalledWith("workspace");
});

it("keeps no stale entries after a failed reading", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(fetchPlanTemplates)
    .mockResolvedValueOnce([FIRST])
    .mockRejectedValueOnce(new Error("offline"));
  const { result } = renderHook(() => usePlanTemplateList("workspace"));
  act(() => result.current.load());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  act(() => result.current.load());
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.templates).toEqual([]);
  expect(error).toHaveBeenCalledOnce();
});

it("puts a saved template on top once and marks it", async () => {
  vi.mocked(fetchPlanTemplates).mockResolvedValueOnce([FIRST, SECOND]);
  const { result } = renderHook(() => usePlanTemplateList("workspace"));
  act(() => result.current.load());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  const renamed = { ...SECOND, name: "Renamed" };
  act(() => result.current.add(renamed));
  expect(result.current.templates).toEqual([renamed, FIRST]);
  expect(result.current.savedId).toBe("second");
});

it("counts a list read for another workspace as not loaded", async () => {
  vi.mocked(fetchPlanTemplates).mockResolvedValueOnce([FIRST]);
  const { result, rerender } = renderHook(
    (props: { workspaceId: string }) => usePlanTemplateList(props.workspaceId),
    { initialProps: { workspaceId: "first" } },
  );
  act(() => result.current.load());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  rerender({ workspaceId: "second" });
  expect(result.current.status).toBe("idle");
  expect(result.current.templates).toEqual([]);
});
