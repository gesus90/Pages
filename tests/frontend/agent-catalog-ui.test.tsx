// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AgentCatalogControls } from "@/app/components/settings/agents/agent-catalog-controls";
import { createI18n } from "@/app/lib/i18n";
import SettingsAgentsRoute from "@/app/routes/settings-agents";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import {
  CLI_LOCATIONS,
  createAgentConnection,
  createCatalogModel,
} from "../helpers/agents";

import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
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

describe("catalog administrative controls", () => {
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

  it.each([false, true])(
    "refreshes catalogs while models and levels are assigned only under Agent tasks (verified: %s)",
    async (isVerified) => {
      const connection = createAgentConnection({
        checks: {
          auth: isVerified
            ? {
                status: "passed",
                errorCode: null,
                checkedAt: "2026-10-08T15:00:00.000Z",
                durationMs: 1,
                detail: {},
              }
            : null,
          model: null,
        },
      });
      let catalog = emptyModelCatalog();
      const onAction = vi.fn((form: FormData): AgentActionResult => {
        catalog = {
          ...CATALOG,
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
      if (!isVerified)
        await user.click(
          screen.getByRole("button", { name: "Refresh catalog" }),
        );
      await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
      expect(onAction.mock.calls[0]?.[0].get("intent")).toBe("refresh-catalog");
      expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
      expect(
        screen.queryByRole("combobox", { name: "Reasoning effort" }),
      ).toBeNull();
      expect(screen.queryByLabelText("Model ID")).toBeNull();
      expect(
        screen.getByText(
          /Assign models and reasoning levels under Agent tasks/,
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
      );
      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "Renamed");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
      expect(onAction.mock.calls[1]?.[0].get("testModel")).toBe(
        connection.testModel ?? "",
      );
      expect(onAction.mock.calls[1]?.[0].get("reasoningEffort")).toBe(
        connection.reasoningEffort ?? "",
      );
    },
  );
});
