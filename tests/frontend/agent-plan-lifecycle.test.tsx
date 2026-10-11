// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ fetcher: vi.fn(), navigate: vi.fn() }));
vi.mock("react-router", () => ({
  useFetcher: router.fetcher,
  useNavigate: () => router.navigate,
}));

import { usePlanEditor } from "@/app/components/agents/plans/use-plan-editor";
import { usePlanRun } from "@/app/components/agents/plans/use-plan-run";

import { planUiPage, planUiRun, planUiStep } from "../helpers/agent-plan-ui";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { PlanSourceResponse } from "@/app/components/agents/plans/use-plan-editor";

interface FetcherDouble {
  state: "idle" | "submitting" | "loading";
  data: AgentPlanActionResult | PlanSourceResponse | undefined;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly load: ReturnType<typeof vi.fn>;
}

function fetcher(): FetcherDouble {
  return { state: "idle", data: undefined, submit: vi.fn(), load: vi.fn() };
}

beforeEach(() => router.navigate.mockReset());
afterEach(() => vi.useRealTimers());

describe("A10 editor request and dirty-state lifecycle", () => {
  it("suppresses unsaved Play, serializes the submitted graph and retains edits made during a pending save", () => {
    const command = fetcher();
    const sources = fetcher();
    router.fetcher.mockImplementation(() =>
      router.fetcher.mock.calls.length % 2 === 1 ? command : sources,
    );
    const page = planUiPage();
    const hook = renderHook(() => usePlanEditor(page));
    act(() => hook.result.current.play());
    expect(command.submit).toHaveBeenCalledWith(
      { intent: "play-plan", planId: "plan", revision: "1" },
      expect.anything(),
    );
    command.submit.mockClear();
    act(() =>
      hook.result.current.setDraft((previous) => ({
        ...previous,
        name: "Changed",
      })),
    );
    act(() => hook.result.current.play());
    expect(command.submit).not.toHaveBeenCalled();
    act(() => hook.result.current.save());
    expect(command.submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "save-plan", planId: "plan" }),
      { method: "post", action: "/agents/plans" },
    );
    command.state = "submitting";
    command.data = { ok: true, intent: "save-plan", planId: "plan" };
    hook.rerender();
    expect(hook.result.current.isPending).toBe(true);
    expect(hook.result.current.isDirty).toBe(true);
    command.state = "idle";
    hook.rerender();
    expect(hook.result.current.isDirty).toBe(false);
    act(() =>
      hook.result.current.setDraft((previous) => ({
        ...previous,
        name: "Another edit",
      })),
    );
    expect(hook.result.current.isDirty).toBe(true);
    act(() => hook.result.current.stop("run"));
    expect(command.submit).toHaveBeenLastCalledWith(
      { intent: "stop-plan", runId: "run" },
      expect.anything(),
    );
  });

  it("rejects delayed source sets for another workspace, surfaces source failure and navigates only to a new saved ID", () => {
    const command = fetcher();
    const sources = fetcher();
    router.fetcher.mockImplementation(() =>
      router.fetcher.mock.calls.length % 2 === 1 ? command : sources,
    );
    const page = { ...planUiPage(), selected: null };
    const hook = renderHook(() => usePlanEditor(page));
    act(() => hook.result.current.play());
    expect(command.submit).not.toHaveBeenCalled();
    act(() =>
      hook.result.current.setDraft((previous) => ({
        ...previous,
        workspaceId: "other",
      })),
    );
    expect(sources.load).toHaveBeenCalledWith(
      "/agent-api/plan-sources?workspaceId=other",
    );
    sources.data = { workspaceId: "workspace", sources: planUiPage().sources };
    hook.rerender();
    expect(hook.result.current.sources).toEqual({ agents: [], tasks: [] });
    sources.data = { workspaceId: "other", sources: planUiPage().sources };
    hook.rerender();
    expect(hook.result.current.sources.agents).toHaveLength(1);
    sources.data = { ok: false, error: "plan_access_denied" };
    hook.rerender();
    expect(hook.result.current.sourceError).toBe("plan_access_denied");
    act(() => hook.result.current.save());
    expect(command.submit).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "" }),
      expect.anything(),
    );
    command.data = { ok: true, intent: "save-plan", planId: "new plan" };
    hook.rerender();
    expect(router.navigate).toHaveBeenCalledWith(
      "/agents/plans?planId=new%20plan",
    );
    const saved = { ...planUiPage() };
    if (!saved.selected) throw new Error("Missing fixture");
    saved.selected = {
      ...saved.selected,
      canEdit: false,
      nodes: [planUiStep()],
    };
    hook.unmount();
    const shared = renderHook(() => usePlanEditor(saved));
    expect(shared.result.current.canEdit).toBe(false);
  });
});

describe("A10 own-run polling lifecycle", () => {
  it("follows new runs, ignores old responses and stops polling on completion, busy state or permission loss", () => {
    vi.useFakeTimers();
    const poll = fetcher();
    router.fetcher.mockReturnValue(poll);
    const history = [planUiRun()];
    const initialProps: { command: AgentPlanActionResult | undefined } = {
      command: undefined,
    };
    const hook = renderHook(
      ({ command }: { command: AgentPlanActionResult | undefined }) =>
        usePlanRun(history, command),
      { initialProps },
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(poll.load).toHaveBeenCalledWith("/agent-api/plan-runs?runId=run");
    poll.data = {
      ok: true,
      intent: "poll-run",
      run: { ...history[0], id: "old" },
    };
    hook.rerender({ command: undefined });
    expect(hook.result.current.run?.id).toBe("run");
    poll.state = "loading";
    hook.rerender({ command: undefined });
    poll.load.mockClear();
    act(() => vi.advanceTimersByTime(2000));
    expect(poll.load).not.toHaveBeenCalled();
    poll.state = "idle";
    poll.data = {
      ok: true,
      intent: "poll-run",
      run: { ...history[0], status: "succeeded" },
    };
    hook.rerender({ command: undefined });
    expect(hook.result.current.run?.status).toBe("succeeded");
    act(() => vi.advanceTimersByTime(2000));
    expect(poll.load).not.toHaveBeenCalled();
    poll.data = { ok: false, error: "plan_access_denied", runId: "other" };
    hook.rerender({
      command: {
        ok: true,
        intent: "play-plan",
        run: { ...history[0], id: "next" },
      },
    });
    expect(hook.result.current.selectedId).toBe("next");
    expect(hook.result.current.runs).toHaveLength(2);
    poll.data = { ok: false, error: "plan_access_denied", runId: "next" };
    hook.rerender({ command: undefined });
    expect(hook.result.current.run).toBeNull();
    expect(hook.result.current.error).toBe("plan_access_denied");
    act(() => hook.result.current.select("missing"));
    expect(hook.result.current.run).toBeNull();
    expect(hook.result.current.error).toBeNull();
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles empty history and updates an existing own run without duplicating its list entry", () => {
    const poll = fetcher();
    router.fetcher.mockReturnValue(poll);
    const empty = renderHook(() =>
      usePlanRun([], { ok: false, intent: "play-plan", error: "general" }),
    );
    expect(empty.result.current.selectedId).toBe("");
    expect(empty.result.current.run).toBeNull();
    empty.unmount();
    const run = planUiRun();
    const hook = renderHook(() =>
      usePlanRun([run], {
        ok: true,
        intent: "stop-plan",
        run: { ...run, status: "cancelled" },
      }),
    );
    expect(hook.result.current.runs).toHaveLength(1);
    expect(hook.result.current.run?.status).toBe("cancelled");
  });
});
