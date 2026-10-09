// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const submit = vi.hoisted(() => vi.fn());
vi.mock("@/app/components/settings/agents/use-agent-actions", () => ({
  useAgentActions: () => ({
    submit,
    isPending: false,
    pendingIntent: null,
    error: null,
    result: undefined,
  }),
}));

import { useAgentManagement } from "@/app/components/settings/agents/use-agent-management";

import { createCliConnection } from "../helpers/agents";

describe("agent panel coordination", () => {
  it("requires confirmation for logout and ignores a confirmation with no selection", () => {
    const connection = createCliConnection();
    const hook = renderHook(() => useAgentManagement());
    act(() => hook.result.current.confirm());
    expect(submit).not.toHaveBeenCalled();
    act(() => hook.result.current.command(connection, "logout"));
    expect(hook.result.current.confirmation?.command).toBe("logout");
    expect(submit).not.toHaveBeenCalled();
    act(() => hook.result.current.confirm());
    expect(submit).toHaveBeenCalledWith("logout-cli", connection.id);
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("opens login explicitly and tolerates a trigger removed from the document", () => {
    vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
    const connection = createCliConnection();
    const hook = renderHook(() => useAgentManagement());
    act(() => hook.result.current.command(connection, "login"));
    expect(submit).toHaveBeenCalledWith("start-login", connection.id);
    expect(hook.result.current.selection).toEqual({
      kind: "cli_account",
      id: connection.id,
    });
    const event = new Event("closeAutoFocus", { cancelable: true });
    act(() => hook.result.current.returnFocus(event));
    expect(event.defaultPrevented).toBe(true);
    act(() => hook.result.current.command(connection, "auth"));
    expect(submit).toHaveBeenLastCalledWith("run-check", connection.id, {
      kind: "auth",
    });
  });
});
