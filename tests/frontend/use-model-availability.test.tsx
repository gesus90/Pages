// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  modelAccessSince,
  useModelAvailability,
} from "@/app/components/settings/agents/use-model-availability";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import { createAgentConnection, createCliConnection } from "../helpers/agents";

import type { AgentActions } from "@/app/components/settings/agents/use-agent-actions";
import type {
  AgentCliState,
  AgentConnectionSummary,
} from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";

const SIGNED_IN_CLI: AgentCliState = {
  binaryFound: true,
  loggedInAt: "2026-10-08T15:00:00.000Z",
  accountLabel: null,
  login: null,
  terminalCommand: "isolated-command",
};
const SIGNED_IN = createCliConnection({ cli: SIGNED_IN_CLI });

interface HookProps {
  readonly connection: AgentConnectionSummary | undefined;
  readonly catalog: AgentModelCatalog | undefined;
  readonly isBlocked: boolean;
}

function actionsWith(submit: AgentActions["submit"]): AgentActions {
  return {
    isPending: false,
    pendingIntent: null,
    error: null,
    result: undefined,
    submit,
  };
}

describe("model availability after confirmed access", () => {
  it("dates access from the CLI sign-in or a passed API access check only", () => {
    expect(modelAccessSince(undefined)).toBeNull();
    expect(modelAccessSince(SIGNED_IN)).toBe("2026-10-08T15:00:00.000Z");
    expect(modelAccessSince(createCliConnection())).toBeNull();
    const check = {
      errorCode: null,
      checkedAt: "2026-10-08T16:00:00.000Z",
      durationMs: 1,
      detail: {},
    };
    expect(
      modelAccessSince(
        createAgentConnection({
          checks: { auth: { ...check, status: "passed" }, model: null },
        }),
      ),
    ).toBe("2026-10-08T16:00:00.000Z");
    expect(
      modelAccessSince(
        createAgentConnection({
          checks: {
            auth: {
              ...check,
              status: "failed",
              errorCode: "provider_auth_failed",
            },
            model: null,
          },
        }),
      ),
    ).toBeNull();
  });

  it("requests the list once per access, never while blocked or after an attempt since that access", () => {
    const submit = vi.fn();
    const actions = actionsWith(submit);
    const { result, rerender } = renderHook<
      ReturnType<typeof useModelAvailability>,
      HookProps
    >((props) => useModelAvailability({ ...props, actions }), {
      initialProps: {
        connection: SIGNED_IN,
        catalog: emptyModelCatalog(),
        isBlocked: true,
      },
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      isExisting: true,
      isUnlocked: true,
      isLoading: false,
    });
    rerender({
      connection: SIGNED_IN,
      catalog: emptyModelCatalog(),
      isBlocked: false,
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      "refresh-catalog",
      SIGNED_IN.id,
    );
    // A blocked moment, such as the running refresh, does not repeat it.
    rerender({
      connection: SIGNED_IN,
      catalog: emptyModelCatalog(),
      isBlocked: true,
    });
    rerender({
      connection: SIGNED_IN,
      catalog: emptyModelCatalog(),
      isBlocked: false,
    });
    expect(submit).toHaveBeenCalledOnce();
    rerender({
      connection: SIGNED_IN,
      catalog: { ...emptyModelCatalog(), attemptedAt: "2026-10-08T15:01:00Z" },
      isBlocked: false,
    });
    rerender({
      connection: SIGNED_IN,
      catalog: undefined,
      isBlocked: false,
    });
    rerender({
      connection: createCliConnection(),
      catalog: emptyModelCatalog(),
      isBlocked: false,
    });
    expect(submit).toHaveBeenCalledOnce();
    // A new sign-in is a new access and loads the list again.
    const again = createCliConnection({
      cli: { ...SIGNED_IN_CLI, loggedInAt: "2026-10-09T08:00:00.000Z" },
    });
    // The list attempted before this sign-in is due again.
    rerender({
      connection: again,
      catalog: { ...emptyModelCatalog(), attemptedAt: "2026-10-08T15:01:00Z" },
      isBlocked: false,
    });
    expect(submit).toHaveBeenCalledTimes(2);
    rerender({
      connection: undefined,
      catalog: emptyModelCatalog(),
      isBlocked: false,
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({
      isExisting: false,
      isUnlocked: false,
      isLoading: false,
    });
  });

  it("reports a running catalog refresh as loading", () => {
    const { result } = renderHook(() =>
      useModelAvailability({
        connection: createAgentConnection(),
        catalog: emptyModelCatalog(),
        actions: {
          ...actionsWith(vi.fn()),
          isPending: true,
          pendingIntent: "refresh-catalog",
        },
        isBlocked: true,
      }),
    );
    expect(result.current).toEqual({
      isExisting: true,
      isUnlocked: false,
      isLoading: true,
    });
  });
});
