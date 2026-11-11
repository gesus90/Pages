import { act, renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { useAgentAssignment } from "@/app/components/settings/agents/use-agent-assignment";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import type { ReactNode } from "react";
import type {
  AgentConnectionSummary,
  AgentProviderId,
} from "@/definition/AgentConnection";
import type {
  AgentCatalogModel,
  AgentModelCatalog,
} from "@/definition/AgentModelCatalog";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";

const i18n = createI18n("en");

function wrapper({ children }: { children: ReactNode }): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

function catalogModel(
  id: string,
  overrides: Partial<AgentCatalogModel> = {},
): AgentCatalogModel {
  return {
    id,
    name: id,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    reasoning: "none",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    ...overrides,
  };
}

function catalog(
  models: readonly AgentCatalogModel[],
  errorCode: AgentModelCatalog["errorCode"] = null,
): AgentModelCatalog {
  return {
    models,
    intervalHours: 24,
    nextRefreshAt: null,
    attemptedAt: null,
    refreshedAt: null,
    errorCode,
  };
}

/** A verified, active CLI connection unless the overrides say otherwise. */
function cliConnection(
  id: string,
  provider: AgentProviderId = "claude_code",
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return {
    isActive: true,
    id,
    name: `Connection ${id}`,
    provider,
    accessKind: "cli_account",
    hasApiKey: false,
    testModel: null,
    reasoningEffort: null,
    scope: GLOBAL_CONNECTION_SCOPE,
    cli: {
      binaryFound: true,
      loggedInAt: "2026-01-01T00:00:00.000Z",
      accountLabel: null,
      login: null,
      terminalCommand: "claude",
    },
    checks: { auth: null, model: null },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function apiConnection(
  id: string,
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return cliConnection(id, "openrouter", {
    accessKind: "api_key",
    hasApiKey: true,
    cli: null,
    checks: {
      auth: {
        status: "passed",
        errorCode: null,
        checkedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 1,
        detail: {},
      },
      model: null,
    },
    ...overrides,
  });
}

function selection(
  connectionId: string,
  model: string,
  reasoningEffort: string | null = null,
): AgentModelSelection {
  return { connectionId, model, reasoningEffort };
}

function setup(input: {
  assignment: AgentModelSelection | null;
  connections: readonly AgentConnectionSummary[];
  catalogs: Record<string, AgentModelCatalog>;
}): ReturnType<
  typeof renderHook<ReturnType<typeof useAgentAssignment>, unknown>
> {
  return renderHook(() => useAgentAssignment(input), { wrapper });
}

const SONNET = catalogModel("claude-sonnet-5-5", {
  name: "Sonnet",
  reasoning: "levels",
  reasoningEfforts: ["low", "high"],
});

it("starts empty without a saved assignment and reports an unavailable connection", () => {
  const { result } = setup({ assignment: null, connections: [], catalogs: {} });
  expect(result.current).toMatchObject({
    connectionId: "",
    provider: null,
    modelId: "",
    modelKey: "",
    effort: "",
    savedAlias: null,
    error: "connectionUnavailable",
    isCatalogFailed: false,
  });
  expect(result.current.models).toEqual([]);
  expect(result.current.choices).toEqual([]);
});

it("starts on a saved valid assignment without an error", () => {
  const { result } = setup({
    assignment: selection("c1", SONNET.id, "high"),
    connections: [cliConnection("c1")],
    catalogs: { c1: catalog([SONNET]) },
  });
  expect(result.current).toMatchObject({
    connectionId: "c1",
    provider: "claude_code",
    modelId: SONNET.id,
    modelKey: agentModelKey("c1", SONNET.id),
    effort: "high",
    savedAlias: null,
    error: null,
  });
  expect(result.current.models).toEqual([SONNET]);
  expect(result.current.choices.map((choice) => choice.id)).toEqual([
    agentModelKey("c1", SONNET.id),
  ]);
});

it("resolves a stored Claude family alias to the listed version and remembers it", () => {
  const { result } = setup({
    assignment: selection("c1", "sonnet"),
    connections: [cliConnection("c1")],
    catalogs: { c1: catalog([catalogModel("claude-sonnet-5-5")]) },
  });
  expect(result.current.modelId).toBe("claude-sonnet-5-5");
  expect(result.current.savedAlias).toBe("sonnet");
  expect(result.current.modelKey).toBe(
    agentModelKey("c1", "claude-sonnet-5-5"),
  );
  expect(result.current.error).toBeNull();
});

it("keeps a Claude alias that resolves to nothing, and keeps a concrete listed id", () => {
  const unresolved = setup({
    assignment: selection("c1", "opus"),
    connections: [cliConnection("c1")],
    catalogs: { c1: catalog([catalogModel("claude-sonnet-5-5")]) },
  });
  expect(unresolved.result.current.modelId).toBe("opus");
  expect(unresolved.result.current.savedAlias).toBeNull();
  expect(unresolved.result.current.error).toBe("modelUnavailable");

  const concrete = setup({
    assignment: selection("c1", "claude-sonnet-5-5"),
    connections: [cliConnection("c1")],
    catalogs: { c1: catalog([catalogModel("claude-sonnet-5-5")]) },
  });
  expect(concrete.result.current.savedAlias).toBeNull();
});

it("does not resolve aliases for other providers", () => {
  const { result } = setup({
    assignment: selection("c1", "sonnet"),
    connections: [cliConnection("c1", "codex_cli")],
    catalogs: { c1: catalog([catalogModel("claude-sonnet-5-5")]) },
  });
  expect(result.current.modelId).toBe("sonnet");
  expect(result.current.savedAlias).toBeNull();
});

it.each([
  ["an unknown connection", [], "connectionUnavailable"],
  [
    "an inactive connection",
    [cliConnection("c1", "claude_code", { isActive: false })],
    "connectionUnavailable",
  ],
  [
    "a CLI connection that never logged in",
    [
      cliConnection("c1", "claude_code", {
        cli: {
          binaryFound: true,
          loggedInAt: null,
          accountLabel: null,
          login: null,
          terminalCommand: "claude",
        },
      }),
    ],
    "accessUnverified",
  ],
  [
    "a CLI connection without CLI state",
    [cliConnection("c1", "claude_code", { cli: null })],
    "accessUnverified",
  ],
  [
    "an API connection without a stored key",
    [apiConnection("c1", { hasApiKey: false })],
    "accessUnverified",
  ],
  [
    "an API connection whose auth check has not passed",
    [apiConnection("c1", { checks: { auth: null, model: null } })],
    "accessUnverified",
  ],
] as const)("reports %s as %s", (label, connections, expected) => {
  const { result } = setup({
    assignment: selection("c1", "m"),
    connections,
    catalogs: { c1: catalog([catalogModel("m")]) },
  });
  expect(result.current.error, label).toBe(expected);
});

it("reports a missing model and an unsupported or required reasoning effort", () => {
  const connections = [cliConnection("c1")];
  const catalogs = { c1: catalog([SONNET, catalogModel("plain")]) };
  expect(
    setup({ assignment: selection("c1", "gone"), connections, catalogs }).result
      .current.error,
  ).toBe("modelUnavailable");
  expect(
    setup({
      assignment: selection("c1", SONNET.id, "max"),
      connections,
      catalogs,
    }).result.current.error,
  ).toBe("reasoningUnsupported");
  // A model with levels needs no level to be saved as default? It does not: empty is unsupported there.
  expect(
    setup({ assignment: selection("c1", SONNET.id), connections, catalogs })
      .result.current.error,
  ).toBe("reasoningUnsupported");
  expect(
    setup({
      assignment: selection("c1", "plain", "low"),
      connections,
      catalogs,
    }).result.current.error,
  ).toBe("reasoningUnsupported");
  expect(
    setup({ assignment: selection("c1", "plain"), connections, catalogs })
      .result.current.error,
  ).toBeNull();
});

it("lists models of every connection but hides API connections without a key unless saved", () => {
  const connections = [
    cliConnection("cli"),
    apiConnection("keyed"),
    apiConnection("keyless", { hasApiKey: false }),
  ];
  const catalogs = {
    cli: catalog([catalogModel("a")]),
    keyed: catalog([catalogModel("b")]),
    keyless: catalog([catalogModel("c")]),
  };
  const without = setup({ assignment: null, connections, catalogs });
  expect(without.result.current.choices.map((choice) => choice.model)).toEqual([
    "a",
    "b",
  ]);
  const saved = setup({
    assignment: selection("keyless", "c"),
    connections,
    catalogs,
  });
  expect(saved.result.current.choices.map((choice) => choice.model)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

it("flags a failed catalog refresh of any connection", () => {
  const { result } = setup({
    assignment: null,
    connections: [cliConnection("c1")],
    catalogs: { c1: catalog([], "provider_unavailable") },
  });
  expect(result.current.isCatalogFailed).toBe(true);
});

it("explains why a listed model cannot be chosen", () => {
  const connections = [
    cliConnection("ok"),
    cliConnection("off", "claude_code", { isActive: false }),
    cliConnection("unverified", "claude_code", { cli: null }),
  ];
  const catalogs = {
    ok: catalog([catalogModel("a")]),
    off: catalog([catalogModel("b")]),
    unverified: catalog([catalogModel("c")]),
  };
  const { result } = setup({ assignment: null, connections, catalogs });
  const byModel = (model: string): string | null => {
    const choice = result.current.choices.find(
      (entry) => entry.model === model,
    );
    if (!choice) throw new Error("missing choice");
    return result.current.refusalOf(choice);
  };
  expect(byModel("a")).toBeNull();
  expect(byModel("b")).toBe("The connection is switched off.");
  expect(byModel("c")).toBe("The connection's access is not verified.");
  expect(
    result.current.refusalOf({
      ...result.current.choices[0],
      connectionId: "unknown",
    }),
  ).toBe("The connection is switched off.");
});

it("builds the reasoning options from the chosen model and its siblings", () => {
  const { result } = setup({
    assignment: selection("c1", SONNET.id, "low"),
    connections: [cliConnection("c1")],
    catalogs: {
      c1: catalog([
        SONNET,
        catalogModel("other", {
          reasoning: "levels",
          reasoningEfforts: ["low", "xhigh"],
        }),
      ]),
    },
  });
  const options = result.current.effortOptions;
  expect(options.map((option) => option.value)).toEqual([
    "",
    "low",
    "high",
    "xhigh",
  ]);
  expect(options[0].label).toBe("Choose listed level");
  expect(options.find((option) => option.value === "xhigh")?.disabled).toBe(
    true,
  );
});

it("labels the default as unavailable for a model without efforts and ignores siblings for other providers", () => {
  const { result } = setup({
    assignment: selection("c1", "plain"),
    connections: [cliConnection("c1", "opencode")],
    catalogs: {
      c1: catalog([
        catalogModel("plain"),
        catalogModel("other", {
          reasoning: "levels",
          reasoningEfforts: ["low"],
        }),
      ]),
    },
  });
  expect(result.current.effortOptions.map((option) => option.label)).toEqual([
    "No reasoning level available",
  ]);
});

it("chooses connection and model together and clears effort and alias", () => {
  const { result } = setup({
    assignment: selection("c1", "sonnet", "low"),
    connections: [cliConnection("c1"), cliConnection("c2", "codex_cli")],
    catalogs: {
      c1: catalog([SONNET]),
      c2: catalog([
        catalogModel("gpt", { reasoning: "levels", reasoningEfforts: ["low"] }),
      ]),
    },
  });
  expect(result.current.savedAlias).toBe("sonnet");
  expect(result.current.effort).toBe("low");
  act(() => result.current.chooseModel(agentModelKey("c2", "gpt")));
  expect(result.current).toMatchObject({
    connectionId: "c2",
    provider: "codex_cli",
    modelId: "gpt",
    modelKey: agentModelKey("c2", "gpt"),
    savedAlias: null,
    effort: "",
    error: "reasoningUnsupported",
  });
  act(() => result.current.chooseEffort("low"));
  expect(result.current.effort).toBe("low");
  expect(result.current.error).toBeNull();
});

it("ignores a model key that is not listed", () => {
  const { result } = setup({
    assignment: selection("c1", SONNET.id, "low"),
    connections: [cliConnection("c1")],
    catalogs: { c1: catalog([SONNET]) },
  });
  act(() => result.current.chooseModel('["c1","nope"]'));
  expect(result.current).toMatchObject({
    connectionId: "c1",
    modelId: SONNET.id,
    effort: "low",
  });
});
