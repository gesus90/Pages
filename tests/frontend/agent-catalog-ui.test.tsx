// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AgentModelField } from "@/app/components/settings/agents/agent-model-field";
import { AgentCatalogControls } from "@/app/components/settings/agents/agent-catalog-controls";
import { createI18n } from "@/app/lib/i18n";
import SettingsAgentsRoute from "@/app/routes/settings-agents";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import {
  CLI_LOCATIONS,
  createAgentConnection,
  createCatalogModel,
} from "../helpers/agents";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { AgentForm } from "@/app/components/settings/agents/use-agent-form";
import type { AgentModelAvailability } from "@/app/components/settings/agents/use-model-availability";
import type { AgentActions } from "@/app/components/settings/agents/use-agent-actions";
import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";

const CATALOG: AgentModelCatalog = {
  ...emptyModelCatalog(),
  models: [
    createCatalogModel({
      id: "vendor/free-model",
      name: "Free model",
      promptPrice: "0",
      completionPrice: "0",
      isFree: true,
    }),
    createCatalogModel({
      id: "vendor/paid-model:free",
      name: "Paid model",
      contextWindow: 1000,
      promptPrice: "0",
      completionPrice: "0.01",
      reasoning: "none",
    }),
  ],
};
const LEVELS_CATALOG: AgentModelCatalog = {
  ...emptyModelCatalog(),
  models: [
    createCatalogModel({
      id: "vendor/reasoner",
      name: "Reasoner",
      reasoning: "levels",
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    }),
    createCatalogModel({
      id: "vendor/light",
      name: "Light",
      reasoning: "levels",
      reasoningEfforts: ["low"],
    }),
    createCatalogModel({
      id: "vendor/auto",
      name: "Auto",
      reasoning: "automatic",
    }),
  ],
};
const READY: AgentModelAvailability = {
  isExisting: true,
  isUnlocked: true,
  isLoading: false,
};

function FieldStory({
  catalog = CATALOG,
  initial = "unknown-id",
  effort = "",
  isSaving = false,
  error = null,
  provider = "openrouter",
  availability = READY,
}: {
  /** `null` stands for a provider without a model catalog. */
  readonly catalog?: AgentModelCatalog | null;
  readonly initial?: string;
  readonly effort?: string;
  readonly isSaving?: boolean;
  readonly error?: AgentForm["error"];
  readonly provider?: AgentProviderId;
  readonly availability?: AgentModelAvailability;
}) {
  const [fields, setFields] = useState<AgentForm["fields"]>({
    name: "Example",
    apiKey: "",
    provider,
    testModel: initial,
    reasoningEffort: effort,
  });
  const form: AgentForm = {
    fields,
    setField: (key, value) =>
      setFields((current) => ({ ...current, [key]: value })),
    isDirty: false,
    isSaving,
    savedCount: 0,
    error,
    handleSubmit: () => undefined,
  };
  return (
    <>
      <AgentModelField
        form={form}
        catalog={catalog ?? undefined}
        availability={availability}
      />
      <output data-testid="saved-choice">
        {fields.testModel}|{fields.reasoningEffort}
      </output>
    </>
  );
}

function localized(content: React.ReactElement, language: "de" | "en" = "en") {
  return render(
    <I18nextProvider i18n={createI18n(language)}>{content}</I18nextProvider>,
  );
}

function controls(
  catalog: AgentModelCatalog,
  overrides: Partial<AgentActions> = {},
  disabled = false,
  isCli = false,
) {
  const submit = vi.fn();
  const actions: AgentActions = {
    isPending: false,
    pendingIntent: null,
    error: null,
    result: undefined,
    submit,
    ...overrides,
  };
  localized(
    <AgentCatalogControls
      id="one"
      catalog={catalog}
      actions={actions}
      disabled={disabled}
      isCli={isCli}
    />,
  );
  return submit;
}

describe("catalog model selection and administrative controls", () => {
  it("searches IDs and names case-insensitively and switches between catalog and manual IDs without testing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localized(<FieldStory />);
    // A saved ID outside the list stays visible as a manual entry.
    expect(screen.getByLabelText("Model ID")).toHaveValue("unknown-id");
    const selection = screen.getByRole("combobox", {
      name: "Model",
    });
    expect(selection).toHaveTextContent("Enter another model ID manually");
    await user.click(selection);
    expect(
      screen.getByRole("option", { name: "Choose a model" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("option", {
        name: "Free model (vendor/free-model) · Free",
      }),
    );
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(
      "vendor/free-model|",
    );
    expect(
      screen.getByText("Free", { selector: "span.rounded-full" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/contains no reasoning information/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search models"), "PAID");
    expect(screen.getByText("1 of 2 models")).toBeInTheDocument();
    // The selected ID stays listed while the search filters it out.
    await user.click(selection);
    expect(
      screen.getByRole("option", {
        name: "Free model (vendor/free-model) · Free",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("option", {
        name: "Paid model (vendor/paid-model:free)",
      }),
    );
    expect(
      screen.queryByText("Free", { selector: "span.rounded-full" }),
    ).toBeNull();
    expect(screen.getByText(/does not support reasoning/)).toBeInTheDocument();
    await user.click(selection);
    await user.click(
      screen.getByRole("option", { name: "Enter another model ID manually" }),
    );
    expect(screen.getByLabelText("Model ID")).toHaveValue(
      "vendor/paid-model:free",
    );
    await user.clear(screen.getByLabelText("Model ID"));
    await user.type(screen.getByLabelText("Model ID"), "new-private-id");
    expect(selection).toHaveTextContent("Enter another model ID manually");
    expect(screen.getByText(/Manually entered model IDs/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search models"));
    await user.type(screen.getByLabelText("Search models"), "missing");
    expect(screen.getByText("0 of 2 models")).toBeInTheDocument();
    expect(screen.getByLabelText("Model ID")).toHaveValue("new-private-id");
    await user.click(selection);
    await user.click(screen.getByRole("option", { name: "Choose a model" }));
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(/^\|$/);
    expect(screen.getByText(/marks no default model/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers only the listed reasoning levels and resets a level the next model lacks", async () => {
    const user = userEvent.setup();
    localized(
      <FieldStory catalog={LEVELS_CATALOG} initial="vendor/reasoner" />,
    );
    const reasoning = screen.getByRole("combobox", {
      name: "Reasoning effort",
    });
    expect(reasoning).toHaveTextContent("Default (medium)");
    expect(
      screen.getByText(/levels come from the model list/),
    ).toBeInTheDocument();
    await user.click(reasoning);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Default (medium)", "low", "medium", "high"]);
    await user.click(screen.getByRole("option", { name: "high" }));
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(
      "vendor/reasoner|high",
    );
    const selection = screen.getByRole("combobox", {
      name: "Model",
    });
    await user.click(selection);
    await user.click(
      screen.getByRole("option", { name: "Light (vendor/light)" }),
    );
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(
      /^vendor\/light\|$/,
    );
    expect(reasoning).toHaveTextContent("Provider default");
    await user.click(reasoning);
    await user.click(screen.getByRole("option", { name: "low" }));
    await user.click(selection);
    await user.click(
      screen.getByRole("option", { name: "Reasoner (vendor/reasoner)" }),
    );
    // A level the next model lists as well is kept.
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(
      "vendor/reasoner|low",
    );
    await user.click(selection);
    await user.click(
      screen.getByRole("option", { name: "Auto (vendor/auto)" }),
    );
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(
      /^vendor\/auto\|$/,
    );
    expect(
      screen.queryByRole("combobox", { name: "Reasoning effort" }),
    ).toBeNull();
    expect(
      screen.getByText(/manages its reasoning itself/),
    ).toBeInTheDocument();
  });

  it("keeps a saved level the model list no longer offers visible until it is reset", async () => {
    const user = userEvent.setup();
    const story = localized(
      <FieldStory
        catalog={LEVELS_CATALOG}
        initial="vendor/light"
        effort="max"
      />,
    );
    const reasoning = screen.getByRole("combobox", {
      name: "Reasoning effort",
    });
    expect(reasoning).toHaveTextContent("“max” (saved, no longer listed)");
    await user.click(reasoning);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Provider default", "low", "“max” (saved, no longer listed)"]);
    await user.click(screen.getByRole("option", { name: "Provider default" }));
    expect(screen.getByTestId("saved-choice")).toHaveTextContent(
      /^vendor\/light\|$/,
    );
    await user.click(reasoning);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    story.unmount();
    // Without listed levels the saved value alone stays selectable.
    localized(
      <FieldStory initial="vendor/paid-model:free" effort="high" />,
      "de",
    );
    expect(
      screen.getByRole("combobox", { name: "Reasoning-Stufe" }),
    ).toHaveTextContent("„high“ (gespeichert, nicht mehr gelistet)");
    expect(
      screen.getByText(/unterstützt dieses Modell kein Reasoning/),
    ).toBeInTheDocument();
  });

  it("explains every state before the model list can be used", () => {
    const states: readonly [React.ReactElement, RegExp][] = [
      [
        <FieldStory key="new" availability={{ ...READY, isExisting: false }} />,
        /can be set up after saving/,
      ],
      [
        <FieldStory
          key="api"
          catalog={emptyModelCatalog()}
          availability={{ ...READY, isUnlocked: false }}
        />,
        /after a successful access check/,
      ],
      [
        <FieldStory
          key="cli"
          provider="claude_code"
          catalog={emptyModelCatalog()}
          availability={{ ...READY, isUnlocked: false }}
        />,
        /after a successful CLI sign-in/,
      ],
      [
        <FieldStory
          key="loading"
          catalog={emptyModelCatalog()}
          availability={{ ...READY, isLoading: true }}
        />,
        /Loading the model list/,
      ],
    ];
    for (const [story, text] of states) {
      const view = localized(story);
      expect(screen.getByText(text)).toBeInTheDocument();
      // Until access is confirmed neither list nor manual ID is offered.
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByLabelText("Model ID")).toBeNull();
      view.unmount();
    }
  });

  it("falls back to manual IDs without a usable list, marks their errors and localizes Free labels", async () => {
    const user = userEvent.setup();
    const story = localized(
      <FieldStory catalog={null} initial="" provider="zai" />,
    );
    expect(
      screen.getByText(/offers no retrievable model list/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Checks and the model test use this model ID."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Manually entered model IDs/)).toBeInTheDocument();
    story.rerender(
      <I18nextProvider i18n={createI18n("en")}>
        <FieldStory
          key="failed"
          initial=""
          catalog={{
            ...emptyModelCatalog(),
            errorCode: "provider_unavailable",
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(/list is not available/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Enter a model ID the provider accepts. Checks use the saved model.",
      ),
    ).toBeInTheDocument();
    story.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <FieldStory
          key="pending"
          initial=""
          catalog={emptyModelCatalog()}
          isSaving
          error="test_model_invalid"
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(/noch nicht geladen/)).toBeInTheDocument();
    expect(screen.getByLabelText("Modell-ID")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    story.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <FieldStory key="saving" initial="" isSaving />
      </I18nextProvider>,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    story.unmount();
    localized(<FieldStory initial="vendor/free-model" />, "de");
    expect(
      screen.getByText("Free (kostenlos)", { selector: "span.rounded-full" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    expect(
      screen.getByRole("option", { name: /Free model.*Free \(kostenlos\)/ }),
    ).toBeInTheDocument();
  });

  it("offers the CLI default model and its default reasoning", async () => {
    const user = userEvent.setup();
    localized(<FieldStory initial="" provider="codex_cli" />);
    const selection = screen.getByRole("combobox", {
      name: "Model",
    });
    expect(selection).toHaveTextContent("CLI default model");
    // The CLI default is a choice of its own.
    expect(screen.queryByText(/marks no default model/)).toBeNull();
    expect(
      screen.getByText(/CLI's default reasoning level/),
    ).toBeInTheDocument();
    await user.click(selection);
    await user.click(
      screen.getByRole("option", { name: "Enter another model ID manually" }),
    );
    expect(screen.getByLabelText("Model ID")).toHaveValue("");
    expect(
      screen.getByText("Optional. Leave empty to use the CLI default model."),
    ).toBeInTheDocument();
  });

  it("submits cadence and manual metadata refresh only, and shows retained stale data and timestamps", async () => {
    const user = userEvent.setup();
    const submit = controls({
      ...CATALOG,
      intervalHours: 24,
      attemptedAt: "2026-10-08T15:00:00.000Z",
      refreshedAt: "2026-10-07T15:00:00.000Z",
      nextRefreshAt: "2026-10-09T15:00:00.000Z",
      errorCode: "provider_unavailable",
    });
    expect(screen.getByRole("status")).toHaveTextContent(/retained.*stale/);
    // Times use the region format; the ISO value stays machine-readable only.
    expect(screen.queryByText(/2026-10-0\dT/)).toBeNull();
    expect(screen.getAllByText(/0[789]\.10\.2026/)).toHaveLength(3);
    expect(
      [...document.querySelectorAll("time")].map((time) =>
        time.getAttribute("datetime"),
      ),
    ).toEqual([
      "2026-10-08T15:00:00.000Z",
      "2026-10-07T15:00:00.000Z",
      "2026-10-09T15:00:00.000Z",
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /temporarily unavailable/,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Manual only" }));
    expect(submit).toHaveBeenCalledWith("configure-catalog", "one", {
      intervalHours: "0",
    });
    await user.click(screen.getByRole("button", { name: "Refresh catalog" }));
    expect(submit).toHaveBeenLastCalledWith("refresh-catalog", "one");
  });

  it("shows never/success states and disables pending or unsaved refreshes", () => {
    const submit = controls(
      emptyModelCatalog(),
      { pendingIntent: "refresh-catalog" },
      true,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /No catalog retrieved/,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    const button = screen.getByRole("button", { name: "Refresh catalog" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it("explains that CLI catalogs come from the signed-in CLI", () => {
    controls(emptyModelCatalog(), {}, false, true);
    expect(
      screen.getByText(/Reads the model list of the signed-in CLI/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/does not confirm the API key/)).toBeNull();
  });

  it("integrates saved catalogs in the admin panel and preserves unsaved model input through loader revalidation", async () => {
    const connection = createAgentConnection({ provider: "openrouter" });
    let catalog = emptyModelCatalog();
    const onAction = vi.fn((form: FormData): AgentActionResult => {
      catalog = {
        ...CATALOG,
        attemptedAt: "2026-10-08T15:00:00.000Z",
        refreshedAt: "2026-10-08T15:00:00.000Z",
      };
      return {
        ok: true,
        intent: String(form.get("intent")),
        connectionId: connection.id,
      };
    });
    const Stub = createRoutesStub([
      {
        path: "/settings/agents",
        Component: SettingsAgentsRoute,
        loader: () => ({
          access: "granted",
          connections: [connection],
          cliTools: CLI_LOCATIONS,
          catalogs: { [connection.id]: catalog },
        }),
        action: async ({ request }) => onAction(await request.formData()),
      },
    ]);
    const user = userEvent.setup();
    localized(<Stub initialEntries={["/settings/agents"]} />);
    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );
    expect(screen.queryByLabelText("Search models")).toBeNull();
    expect(
      screen.getByText(/after a successful access check/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh catalog" }));
    expect(
      await screen.findByText(/Catalog refresh succeeded/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Search models")).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction.mock.calls[0]?.[0].get("intent")).toBe("refresh-catalog");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh catalog" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.click(
      screen.getByRole("option", { name: "Enter another model ID manually" }),
    );
    await user.type(screen.getByLabelText("Model ID"), "unknown-id");
    expect(screen.getByLabelText("Model ID")).toHaveValue("unknown-id");
    expect(
      screen.getByRole("button", { name: "Refresh catalog" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    expect(onAction.mock.calls[1]?.[0].get("testModel")).toBe("unknown-id");
    expect(screen.getByLabelText("Model ID")).toHaveValue("unknown-id");
  });

  it("loads the model list once after a passed access check and saves the chosen effort", async () => {
    const connection = createAgentConnection({
      provider: "openrouter",
      checks: {
        auth: {
          status: "passed",
          errorCode: null,
          checkedAt: "2026-10-08T15:00:00.000Z",
          durationMs: 120,
          detail: {},
        },
        model: null,
      },
    });
    let catalog = emptyModelCatalog();
    const onAction = vi.fn((form: FormData): AgentActionResult => {
      if (form.get("intent") === "refresh-catalog")
        catalog = {
          ...LEVELS_CATALOG,
          attemptedAt: "2026-10-08T15:01:00.000Z",
          refreshedAt: "2026-10-08T15:01:00.000Z",
        };
      return {
        ok: true,
        intent: String(form.get("intent")),
        connectionId: connection.id,
      };
    });
    const Stub = createRoutesStub([
      {
        path: "/settings/agents",
        Component: SettingsAgentsRoute,
        loader: () => ({
          access: "granted",
          connections: [connection],
          cliTools: CLI_LOCATIONS,
          catalogs: { [connection.id]: catalog },
        }),
        action: async ({ request }) => onAction(await request.formData()),
      },
    ]);
    const user = userEvent.setup();
    localized(<Stub initialEntries={["/settings/agents"]} />);
    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );
    const selection = await screen.findByRole("combobox", {
      name: "Model",
    });
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction.mock.calls[0]?.[0].get("intent")).toBe("refresh-catalog");
    await user.click(selection);
    await user.click(
      screen.getByRole("option", { name: "Reasoner (vendor/reasoner)" }),
    );
    await user.click(
      screen.getByRole("combobox", { name: "Reasoning effort" }),
    );
    await user.click(screen.getByRole("option", { name: "high" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    const saved = onAction.mock.calls[1]?.[0];
    expect(saved?.get("testModel")).toBe("vendor/reasoner");
    expect(saved?.get("reasoningEffort")).toBe("high");
    // The attempted catalog is not requested again after revalidation.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
