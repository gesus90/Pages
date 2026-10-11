// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("react-router", () => ({ useFetcher: router.fetcher }));

import { useWorkspaceForm } from "@/app/components/agents/workspaces/use-workspace-form";
import { useAgentProfileForm } from "@/app/components/settings/agents/use-agent-profile-form";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import { createAgentConnection, createCatalogModel } from "../helpers/agents";
import { planUiPage } from "../helpers/agent-plan-ui";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentProfileFormProps } from "@/app/components/settings/agents/use-agent-profile-form";

interface FetcherDouble {
  state: "idle" | "submitting" | "loading";
  data: AgentActionResult | undefined;
}
let fetcher: FetcherDouble;
beforeEach(() => {
  fetcher = { state: "idle", data: undefined };
  router.fetcher.mockReturnValue(fetcher);
});

describe("A10 agent and workspace draft dismissal lifecycle", () => {
  it("blocks duplicate declarations and invalid active templates while permitting corrected or inactive drafts", () => {
    const configuration = emptyAgentConfiguration("system");
    const props: AgentProfileFormProps = {
      profile: {
        id: "profile",
        name: "Worker",
        connectionId: "access",
        model: "model-a",
        reasoningEffort: null,
        isActive: true,
        purposes: ["agent"],
        targets: [],
        configuration,
      },
      connections: [createAgentConnection({ id: "access" })],
      catalogs: {
        access: {
          ...emptyModelCatalog(),
          models: [createCatalogModel({ id: "model-a" })],
        },
      },
      directory: { persons: [], groups: [], departments: [] },
      onSaved: vi.fn(),
    };
    const hook = renderHook(() => useAgentProfileForm(props));
    expect(hook.result.current.isInvalid).toBe(false);
    const parameter = {
      name: "input",
      type: "text" as const,
      description: "",
      isRequired: true,
      defaultValue: null,
    };
    act(() =>
      hook.result.current.draft.setConfiguration({
        ...configuration,
        markdown: "{{input}}",
        parameters: [parameter, parameter],
      }),
    );
    expect(hook.result.current.isInvalid).toBe(true);
    act(() =>
      hook.result.current.draft.setConfiguration({
        ...configuration,
        markdown: "{{input}}",
        parameters: [parameter],
      }),
    );
    expect(hook.result.current.isInvalid).toBe(false);
    act(() =>
      hook.result.current.draft.setConfiguration({
        ...configuration,
        markdown: "{{input",
        parameters: [parameter],
      }),
    );
    expect(hook.result.current.isInvalid).toBe(true);
    act(() => hook.result.current.draft.setActive(false));
    expect(hook.result.current.isInvalid).toBe(false);
  });
  it("reopens workspace revision, prevents pending dismissal and protects dirty tab closes", () => {
    const onSaved = vi.fn();
    const workspace = {
      ...planUiPage().workspaces[0],
      revision: 3,
      canManage: true,
      targets: [{ kind: "person" as const, targetId: "bob" }],
    };
    const hook = renderHook(() => useWorkspaceForm(workspace, onSaved));
    expect(hook.result.current.input).toMatchObject({
      revision: 3,
      name: "Development",
    });
    const preventDefault = vi.fn();
    act(() => hook.result.current.guardDismiss({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
    onSaved.mockClear();
    fetcher.state = "submitting";
    hook.rerender();
    act(() => hook.result.current.requestClose());
    expect(onSaved).not.toHaveBeenCalled();
    fetcher.state = "idle";
    hook.rerender();
    act(() =>
      hook.result.current.setInput({
        ...hook.result.current.input,
        name: "Unsaved",
      }),
    );
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => hook.result.current.requestClose());
    expect(hook.result.current.shouldConfirmClose).toBe(true);
    act(() => hook.result.current.setConfirmClose(false));
    fetcher.data = {
      ok: true,
      intent: "workspace-usages",
      workspaceUsages: [],
    };
    hook.rerender();
    expect(onSaved).not.toHaveBeenCalled();
    fetcher.data = { ok: true, intent: "save-workspace" };
    hook.rerender();
    expect(onSaved).toHaveBeenCalledOnce();
    hook.unmount();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("uses identical clean, dirty and pending guards for the central agent editor", () => {
    const onSaved = vi.fn();
    const props: AgentProfileFormProps = {
      profile: {
        id: "profile",
        name: "Worker",
        connectionId: "access",
        model: "model-a",
        reasoningEffort: null,
        isActive: true,
        purposes: ["agent"],
        targets: [{ kind: "system", targetId: "agent" }],
        configuration: emptyAgentConfiguration("system"),
        revision: 1,
      },
      connections: [createAgentConnection({ id: "access" })],
      catalogs: {
        access: {
          ...emptyModelCatalog(),
          models: [createCatalogModel({ id: "model-a" })],
        },
      },
      directory: { persons: [], groups: [], departments: [] },
      onSaved,
    };
    const hook = renderHook(() => useAgentProfileForm(props));
    const preventDefault = vi.fn();
    act(() => hook.result.current.dismissal.guardDismiss({ preventDefault }));
    expect(onSaved).toHaveBeenCalledOnce();
    onSaved.mockClear();
    fetcher.state = "loading";
    hook.rerender();
    act(() => hook.result.current.dismissal.requestClose());
    expect(onSaved).not.toHaveBeenCalled();
    fetcher.state = "idle";
    hook.rerender();
    act(() => hook.result.current.draft.setName("Dirty"));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => hook.result.current.dismissal.guardDismiss({ preventDefault }));
    expect(hook.result.current.dismissal.shouldConfirmClose).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    hook.unmount();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
