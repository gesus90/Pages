import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { PicaSettingsCard } from "@/app/components/settings/agents/pica-settings-card";
import { createI18n } from "@/app/lib/i18n";

import { pageModel } from "../../agents/plans/plan-model-fixture";

import type * as SelectModule from "@/app/components/ui/select";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PicaAdministration } from "@/definition/PicaSettings";

interface FetcherState {
  data: unknown;
  state: "idle" | "submitting";
  Form: (props: React.ComponentProps<"form">) => React.ReactElement;
}

const fetcher = vi.hoisted((): FetcherState => ({
  data: undefined,
  state: "idle",
  Form: (props) => <form {...props} />,
}));
const selectChanges = vi.hoisted(
  () => new Map<string, (value: string) => void>(),
);

vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
// The real select; its change callbacks are kept by label, because Radix needs pointer APIs jsdom lacks.
vi.mock("@/app/components/ui/select", async (importOriginal) => {
  const actual = await importOriginal<typeof SelectModule>();
  function Select(
    props: React.ComponentProps<typeof actual.Select>,
  ): React.ReactElement {
    selectChanges.set(props.ariaLabel ?? "", props.onValueChange);
    return <actual.Select {...props} />;
  }
  return { ...actual, Select };
});

const i18n = createI18n("en");

const SONNET = pageModel("sonnet", {
  connectionId: "c1",
  provider: "claude_code",
  model: "claude-sonnet-5-5",
  modelName: "Sonnet",
  reasoning: "levels",
  reasoningEfforts: ["low", "high"],
});
const HAIKU = pageModel("haiku", {
  connectionId: "c1",
  provider: "claude_code",
  model: "claude-haiku-5-5",
  modelName: "Haiku",
});
const API_ONLY = pageModel("api", {
  connectionId: "c2",
  provider: "openai",
  model: "gpt-api",
  modelName: "GPT API",
});

function settings(
  overrides: Partial<PicaAdministration> = {},
): PicaAdministration {
  return {
    isEnabled: true,
    selection: {
      connectionId: "c1",
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
    },
    run: null,
    revision: 1,
    error: null,
    ...overrides,
  };
}

function card(
  options: {
    settings?: PicaAdministration;
    models?: readonly PageAgentModel[];
    isCatalogFailed?: boolean;
  } = {},
): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <PicaSettingsCard
        settings={options.settings ?? settings()}
        models={options.models ?? [SONNET, HAIKU, API_ONLY]}
        isCatalogFailed={options.isCatalogFailed}
      />
    </I18nextProvider>
  );
}

function submitted(): Record<string, string> {
  const form = document.querySelector("form");
  if (!form) throw new Error("no form");
  const entries = [...new FormData(form).entries()];
  return Object.fromEntries(
    entries.map(([name, value]) => [name, String(value)]),
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Model/u });
}

/** Finds the model in the open picker by its search field and takes the first match. */
function chooseModel(name: string): void {
  fireEvent.click(trigger());
  const search = screen.getByRole("combobox", {
    name: "Search model or provider",
  });
  fireEvent.change(search, { target: { value: name } });
  fireEvent.keyDown(search, { key: "Enter" });
}

beforeEach(() => {
  // jsdom has no layout, so the picker's list cannot scroll.
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  fetcher.data = undefined;
  fetcher.state = "idle";
  selectChanges.clear();
});

it("shows the fixed local target and submits the saved choice", () => {
  render(card());
  expect(screen.getByText("Local · Pages host")).toBeTruthy();
  expect(submitted()).toEqual({
    intent: "save-pica",
    revision: "1",
    isEnabled: "true",
    modelConnectionId: "c1",
    model: "claude-sonnet-5-5",
    reasoningEffort: "high",
  });
  expect(trigger().textContent).toContain("Sonnet");
  expect(screen.queryByRole("status")).toBeNull();
});

it("submits an empty selection when nothing is saved", () => {
  render(card({ settings: settings({ selection: null }) }));
  expect(submitted()).toMatchObject({
    modelConnectionId: "",
    model: "",
    reasoningEffort: "",
  });
  expect(trigger().textContent).toContain("Choose a model");
});

it("shows all providers and disables models Pica cannot chat with", () => {
  render(card());
  fireEvent.click(trigger());
  expect(screen.getByRole("treeitem", { name: "Haiku" })).toBeTruthy();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Search model or provider" }),
    { target: { value: "GPT API" } },
  );
  expect(screen.getByText("GPT API")).toBeTruthy();
  expect(
    screen
      .getByRole("treeitem", { name: /GPT API/u })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});

it("tells that no model qualifies when the list is empty", () => {
  render(card({ models: [], settings: settings({ selection: null }) }));
  fireEvent.click(trigger());
  expect(
    screen.getByText(/No connection that is set up offers a model/u),
  ).toBeTruthy();
});

it("switches Pica off in the submission and locks the model fields", () => {
  render(card());
  expect(trigger().hasAttribute("disabled")).toBe(false);
  act(() => selectChanges.get("Enable Pica")?.("false"));
  expect(submitted().isEnabled).toBe("false");
  expect(trigger().hasAttribute("disabled")).toBe(true);
  act(() => selectChanges.get("Enable Pica")?.("true"));
  expect(submitted().isEnabled).toBe("true");
  expect(trigger().hasAttribute("disabled")).toBe(false);
});

it("locks everything while a save is pending", () => {
  fetcher.state = "submitting";
  fetcher.data = { ok: true };
  render(card());
  expect(
    screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(trigger().hasAttribute("disabled")).toBe(true);
  expect(
    screen
      .getByRole("combobox", { name: "Enable Pica" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByText("Pica settings saved.")).toBeNull();
});

it("confirms a successful save", () => {
  fetcher.data = { ok: true };
  render(card());
  expect(screen.getByRole("status").textContent).toBe("Pica settings saved.");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the server's own message for a refusal and falls back to a general one", () => {
  fetcher.data = { ok: false, error: "modelUnavailable" };
  const view = render(card());
  expect(screen.getByRole("alert").textContent).toContain(
    "The model chosen for Pica is not (or no longer) in the catalog",
  );
  expect(screen.queryByText("Pica settings saved.")).toBeNull();
  fetcher.data = { ok: false, error: "somethingNew" };
  view.rerender(card());
  expect(screen.getByRole("alert").textContent).toBe(
    "That did not work. Please try again.",
  );
});

it("changes the model and resets an effort the new model does not support", () => {
  render(card());
  chooseModel("Haiku");
  expect(submitted()).toMatchObject({
    model: "claude-haiku-5-5",
    modelConnectionId: "c1",
    reasoningEffort: "",
  });
  expect(
    screen.getByText(/does not support the previous reasoning level/u),
  ).toBeTruthy();
  expect(screen.getByText("No reasoning level available")).toBeTruthy();
});

it("keeps a supported effort when another model offers it too", () => {
  const other = pageModel("opus", {
    connectionId: "c1",
    provider: "claude_code",
    model: "claude-opus-5-5",
    modelName: "Opus",
    reasoning: "levels",
    reasoningEfforts: ["low", "high", "max"],
  });
  render(card({ models: [SONNET, other] }));
  chooseModel("Opus");
  expect(submitted()).toMatchObject({
    model: "claude-opus-5-5",
    reasoningEffort: "high",
  });
  expect(
    screen.queryByText(/does not support the previous reasoning level/u),
  ).toBeNull();
});

it("changes the reasoning effort through its select", () => {
  render(card());
  act(() => selectChanges.get("Reasoning")?.("low"));
  expect(submitted().reasoningEffort).toBe("low");
});

it("names a saved model that is not among the models Pica can run", () => {
  render(
    card({
      settings: settings({
        selection: {
          connectionId: "c9",
          model: "retired-model",
          reasoningEffort: null,
        },
      }),
    }),
  );
  expect(screen.getByRole("status").textContent).toContain("“retired-model”");
  // The saved choice still travels as it is, so nothing is silently replaced.
  expect(submitted()).toMatchObject({
    modelConnectionId: "c9",
    model: "retired-model",
  });
  chooseModel("Haiku");
  expect(screen.queryByText(/not among the models Pica can use/u)).toBeNull();
});

it("shows the API adoption proposal and starts on it", () => {
  const adoption = {
    ...HAIKU,
    connectionId: "c1",
    reasoningEffort: null,
  };
  render(
    card({
      settings: settings({
        selection: {
          connectionId: "c2",
          model: "gpt-api",
          reasoningEffort: null,
        },
        adoption: adoption,
      }),
    }),
  );
  expect(
    screen.getByText(/available through opencode as claude-haiku-5-5/u),
  ).toBeTruthy();
  expect(trigger().textContent).toContain("Haiku");
  expect(submitted()).toMatchObject({ model: "claude-haiku-5-5" });
});

it("explains a saved Claude alias, and drops the note after another choice", () => {
  render(
    card({
      settings: settings({
        selection: {
          connectionId: "c1",
          model: "sonnet",
          reasoningEffort: null,
        },
      }),
    }),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "The saved value is the alias “sonnet”. It stands for Sonnet (claude-sonnet-5-5)",
  );
  expect(submitted().model).toBe("claude-sonnet-5-5");
  chooseModel("Haiku");
  expect(screen.queryByText(/The saved value is the alias/u)).toBeNull();
});

it("warns about an alias that cannot be tied to one version", () => {
  render(
    card({
      settings: settings({
        selection: {
          connectionId: "c1",
          model: "opus",
          reasoningEffort: null,
        },
      }),
    }),
  );
  expect(
    screen.getByText(
      /The saved alias “opus” cannot be tied to exactly one version/u,
    ),
  ).toBeTruthy();
  expect(submitted().model).toBe("opus");
});

it("shows what is wrong with the saved selection", () => {
  render(card({ settings: settings({ error: "modelUnavailable" }) }));
  const text = screen.getAllByRole("status").map((node) => node.textContent);
  expect(
    text.some((entry) =>
      entry?.startsWith(
        "Check the saved Pica selection: The model chosen for Pica",
      ),
    ),
  ).toBe(true);
});

it("starts the draft over when the saved revision changes", () => {
  const view = render(card());
  act(() => selectChanges.get("Enable Pica")?.("false"));
  expect(submitted().isEnabled).toBe("false");
  view.rerender(card({ settings: settings({ revision: 2, isEnabled: true }) }));
  expect(submitted()).toMatchObject({ revision: "2", isEnabled: "true" });
});
