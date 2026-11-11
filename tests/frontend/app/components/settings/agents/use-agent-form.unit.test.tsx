import { act, renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { useAgentForm } from "@/app/components/settings/agents/use-agent-form";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type { FormEvent, ReactNode } from "react";

interface FetcherState {
  data: AgentActionResult | undefined;
  state: "idle" | "submitting";
  submit: ReturnType<typeof vi.fn>;
}

const fetcher = vi.hoisted((): FetcherState => ({
  data: undefined,
  state: "idle",
  submit: vi.fn(),
}));
const showSuccessToast = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
vi.mock("@/app/components/ui/toast", () => ({ showSuccessToast }));

const i18n = createI18n("en");

function wrapper({ children }: { children: ReactNode }): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

const RESTRICTED: AgentConnectionScope = {
  mode: "restricted",
  targets: [
    { kind: "person", targetId: "p1" },
    { kind: "group", targetId: "g1" },
  ],
};

function connection(
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return {
    isActive: true,
    id: "c1",
    name: "Main",
    provider: "openrouter",
    accessKind: "api_key",
    hasApiKey: true,
    testModel: "model-a",
    reasoningEffort: "high",
    scope: GLOBAL_CONNECTION_SCOPE,
    cli: null,
    checks: { auth: null, model: null },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function submitEvent(): FormEvent<HTMLFormElement> {
  const event = new Event("submit", { cancelable: true });
  Object.defineProperty(event, "currentTarget", { value: null });
  return event as unknown as FormEvent<HTMLFormElement>;
}

function submitted(): Record<string, string> {
  return fetcher.submit.mock.calls[0]?.[0] as Record<string, string>;
}

function renderForm(
  kind: "api_key" | "cli_account",
  initial: AgentConnectionSummary | undefined,
  onSaved = vi.fn(),
): {
  readonly result: { readonly current: ReturnType<typeof useAgentForm> };
  readonly rerenderWith: (next: AgentConnectionSummary | undefined) => void;
  readonly onSaved: ReturnType<typeof vi.fn>;
} {
  const view = renderHook(
    ({ summary }) => useAgentForm(kind, summary, onSaved),
    { wrapper, initialProps: { summary: initial } },
  );

  return {
    result: view.result,
    rerenderWith: (next) => view.rerender({ summary: next }),
    onSaved,
  };
}

function finishWith(result: AgentActionResult, rerender: () => void): void {
  fetcher.data = result;
  fetcher.state = "idle";
  act(rerender);
}

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
  showSuccessToast.mockReset();
});

it("starts a new API connection with the first API provider and empty fields", () => {
  const { result } = renderForm("api_key", undefined);

  expect(result.current.fields).toEqual({
    name: "",
    provider: "openrouter",
    apiKey: "",
    testModel: "",
    reasoningEffort: "",
    scope: GLOBAL_CONNECTION_SCOPE,
    zaiAccountType: "",
  });
  expect(result.current.isDirty).toBe(false);
  expect(result.current.isSaving).toBe(false);
  expect(result.current.savedCount).toBe(0);
  expect(result.current.error).toBeNull();
});

it("starts a new CLI connection with Codex", () => {
  const { result } = renderForm("cli_account", undefined);

  expect(result.current.fields.provider).toBe("codex_cli");
});

it("loads the fields of an existing connection without the key", () => {
  const { result } = renderForm(
    "api_key",
    connection({ testModel: null, reasoningEffort: null, scope: RESTRICTED }),
  );

  expect(result.current.fields).toMatchObject({
    name: "Main",
    provider: "openrouter",
    apiKey: "",
    testModel: "",
    reasoningEffort: "",
    scope: RESTRICTED,
    zaiAccountType: "api",
  });
  expect(result.current.isDirty).toBe(false);
});

it("takes the Z.AI account type of the connection", () => {
  const { result } = renderForm(
    "api_key",
    connection({ provider: "zai", zaiAccountType: "coding-plan" }),
  );

  expect(result.current.fields.zaiAccountType).toBe("coding-plan");
});

it("is dirty exactly while a field differs from the saved value", () => {
  const { result } = renderForm("api_key", connection());

  act(() => result.current.setField("name", "Renamed"));

  expect(result.current.fields.name).toBe("Renamed");
  expect(result.current.isDirty).toBe(true);

  act(() => result.current.setField("name", "Main"));

  expect(result.current.isDirty).toBe(false);

  act(() => result.current.setField("apiKey", "sk-new"));

  expect(result.current.isDirty).toBe(true);
});

it("counts a scope with the same targets in another order as unchanged", () => {
  const { result } = renderForm("api_key", connection({ scope: RESTRICTED }));

  act(() =>
    result.current.setField("scope", {
      mode: "restricted",
      targets: [...RESTRICTED.targets].reverse(),
    }),
  );

  expect(result.current.isDirty).toBe(false);

  act(() =>
    result.current.setField("scope", {
      mode: "restricted",
      targets: [{ kind: "person", targetId: "p2" }],
    }),
  );

  expect(result.current.isDirty).toBe(true);
});

it("distinguishes targets of the same kind by id when comparing scopes", () => {
  const { result } = renderForm(
    "api_key",
    connection({
      scope: {
        mode: "restricted",
        targets: [
          { kind: "person", targetId: "b" },
          { kind: "person", targetId: "a" },
        ],
      },
    }),
  );

  act(() =>
    result.current.setField("scope", {
      mode: "restricted",
      targets: [
        { kind: "person", targetId: "a" },
        { kind: "person", targetId: "b" },
      ],
    }),
  );

  expect(result.current.isDirty).toBe(false);
});

it("submits a new connection with its scope and without a connection id", () => {
  const { result } = renderForm("api_key", undefined);
  act(() => {
    result.current.setField("name", "Fresh");
    result.current.setField("apiKey", "sk-secret");
    result.current.setField("testModel", "m1");
  });
  const event = submitEvent();

  act(() => result.current.handleSubmit(event));

  expect(event.defaultPrevented).toBe(true);
  expect(fetcher.submit).toHaveBeenCalledExactlyOnceWith(
    {
      name: "Fresh",
      provider: "openrouter",
      apiKey: "sk-secret",
      testModel: "m1",
      reasoningEffort: "",
      scope: JSON.stringify(GLOBAL_CONNECTION_SCOPE),
      intent: "create-connection",
      connectionId: "",
    },
    { method: "post" },
  );
});

it("submits the Z.AI account type of a new Z.AI connection", () => {
  const { result } = renderForm("api_key", undefined);
  act(() => {
    result.current.setField("provider", "zai");
    result.current.setField("zaiAccountType", "api");
  });

  act(() => result.current.handleSubmit(submitEvent()));

  expect(submitted()).toMatchObject({ provider: "zai", zaiAccountType: "api" });
});

it("leaves the Z.AI account type out for other providers", () => {
  const { result } = renderForm("api_key", undefined);
  act(() => result.current.setField("zaiAccountType", "api"));

  act(() => result.current.handleSubmit(submitEvent()));

  expect(submitted()).not.toHaveProperty("zaiAccountType");
});

it("updates an existing connection without resending an unchanged scope", () => {
  const { result } = renderForm("api_key", connection({ scope: RESTRICTED }));
  act(() => result.current.setField("name", "Renamed"));

  act(() => result.current.handleSubmit(submitEvent()));

  expect(submitted()).toMatchObject({
    name: "Renamed",
    intent: "update-connection",
    connectionId: "c1",
  });
  expect(submitted()).not.toHaveProperty("scope");
  expect(submitted()).not.toHaveProperty("zaiAccountType");
});

it("sends a changed scope of an existing connection", () => {
  const { result } = renderForm("api_key", connection());
  act(() => result.current.setField("scope", RESTRICTED));

  act(() => result.current.handleSubmit(submitEvent()));

  expect(submitted().scope).toBe(JSON.stringify(RESTRICTED));
});

it("sends the Z.AI account type of an existing connection only when it changed", () => {
  const { result } = renderForm(
    "api_key",
    connection({ provider: "zai", zaiAccountType: "api" }),
  );

  act(() => result.current.handleSubmit(submitEvent()));
  expect(submitted()).not.toHaveProperty("zaiAccountType");

  fetcher.submit.mockReset();
  act(() => result.current.setField("zaiAccountType", "coding-plan"));
  act(() => result.current.handleSubmit(submitEvent()));

  expect(submitted().zaiAccountType).toBe("coding-plan");
});

it("reports saving while the fetcher is busy and hides an old error", () => {
  fetcher.data = { ok: false, intent: "update-connection", error: "general" };
  fetcher.state = "submitting";

  const { result } = renderForm("api_key", connection());

  expect(result.current.isSaving).toBe(true);
  expect(result.current.error).toBeNull();
});

it("exposes the refusal of a finished save and keeps the form open", () => {
  fetcher.data = { ok: false, intent: "update-connection", error: "general" };
  const { result, onSaved } = renderForm("api_key", connection());

  expect(result.current.error).toBe("general");
  expect(result.current.isSaving).toBe(false);
  expect(showSuccessToast).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});

it("clears the key, trims the text, announces and reports a successful save", () => {
  const { result, rerenderWith, onSaved } = renderForm("api_key", undefined);
  act(() => {
    result.current.setField("name", "  Fresh  ");
    result.current.setField("apiKey", "sk-secret");
    result.current.setField("testModel", " m1 ");
  });
  expect(result.current.isDirty).toBe(true);

  finishWith(
    { ok: true, intent: "create-connection", connectionId: "c9" },
    () => rerenderWith(undefined),
  );

  expect(result.current.fields).toMatchObject({
    name: "Fresh",
    apiKey: "",
    testModel: "m1",
  });
  expect(result.current.isDirty).toBe(false);
  expect(result.current.savedCount).toBe(1);
  expect(showSuccessToast).toHaveBeenCalledExactlyOnceWith("Connection saved.");
  expect(onSaved).toHaveBeenCalledExactlyOnceWith("c9");
});

it("handles each result once, also across later renders", () => {
  const { result, rerenderWith, onSaved } = renderForm("api_key", connection());
  finishWith(
    { ok: true, intent: "update-connection", connectionId: "c1" },
    () => rerenderWith(connection()),
  );

  act(() => rerenderWith(connection()));
  act(() => result.current.setField("name", "Other"));

  expect(result.current.savedCount).toBe(1);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(showSuccessToast).toHaveBeenCalledTimes(1);
});

it.each([
  {
    label: "a result while still submitting",
    state: "submitting",
    data: { ok: true, intent: "update-connection", connectionId: "c1" },
  },
  {
    label: "a result without a connection id",
    state: "idle",
    data: { ok: true, intent: "update-connection" },
  },
  {
    label: "a result of another intent",
    state: "idle",
    data: { ok: true, intent: "check-connection", connectionId: "c1" },
  },
] as const)(
  "does not treat $label as a saved connection",
  ({ state, data: actionResult }) => {
    fetcher.data = actionResult;
    fetcher.state = state;

    const { result, onSaved } = renderForm("api_key", connection());

    expect(result.current.savedCount).toBe(0);
    expect(showSuccessToast).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  },
);

it("adopts a model that the server stored after access while the form is untouched", () => {
  const { result, rerenderWith } = renderForm(
    "api_key",
    connection({ testModel: null }),
  );

  act(() => rerenderWith(connection({ testModel: "server-default" })));

  expect(result.current.fields.testModel).toBe("server-default");
  expect(result.current.isDirty).toBe(false);
});

it("keeps the model the administrator typed when the server stores another one", () => {
  const { result, rerenderWith } = renderForm(
    "api_key",
    connection({ testModel: null }),
  );
  act(() => result.current.setField("testModel", "typed"));

  act(() => rerenderWith(connection({ testModel: "server-default" })));

  expect(result.current.fields.testModel).toBe("typed");
  expect(result.current.isDirty).toBe(true);

  act(() => result.current.setField("testModel", "server-default"));

  expect(result.current.isDirty).toBe(false);
});

it("adopts a scope that another administrator saved", () => {
  const { result, rerenderWith } = renderForm("api_key", connection());

  act(() => rerenderWith(connection({ scope: RESTRICTED })));

  expect(result.current.fields.scope).toEqual(RESTRICTED);
  expect(result.current.isDirty).toBe(false);

  act(() => result.current.handleSubmit(submitEvent()));
  expect(submitted()).not.toHaveProperty("scope");
});

it("adopts a changed reasoning effort and account type", () => {
  const { result, rerenderWith } = renderForm(
    "api_key",
    connection({ provider: "zai", zaiAccountType: "api" }),
  );

  act(() =>
    rerenderWith(
      connection({
        provider: "zai",
        zaiAccountType: "coding-plan",
        reasoningEffort: "low",
      }),
    ),
  );

  expect(result.current.fields).toMatchObject({
    zaiAccountType: "coding-plan",
    reasoningEffort: "low",
  });
});
