import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { AgentToolCard } from "@/app/components/settings/agents/tools/agent-tool-card";
import { AgentRunOptionsFields } from "@/app/components/settings/agents/agent-run-options-fields";
import { createI18n } from "@/app/lib/i18n";
import {
  acpRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";

import type { ComponentProps } from "react";
import type { AgentToolView } from "@/definition/AgentTools";

interface ToolFetcher {
  state: string;
  result: { readonly ok: boolean; readonly diagnostic?: string } | undefined;
}
const fetcher = vi.hoisted((): ToolFetcher => ({
  state: "idle",
  result: undefined,
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({
    state: fetcher.state,
    data: fetcher.result,
    Form: (props: ComponentProps<"form">) => <form {...props} />,
  }),
}));

const TOOL: AgentToolView = {
  id: "codex",
  name: "OpenAI Codex CLI",
  kind: "agent",
  enabled: true,
  installed: true,
  installedVersion: "0.160.0",
  supportedVersions: ["0.160.0"],
  approvedVersion: "0.160.0",
  updateAvailable: false,
  status: "ready",
  diagnostic: "ready",
  dependency: null,
  source: "managed",
  lastCheck: "2026-10-17T12:00:00.000Z",
  activities: [],
  authentication: [],
};

beforeEach(() => {
  fetcher.state = "idle";
  fetcher.result = undefined;
});

it.each(["de", "en"] as const)(
  "renders installation, readiness and session facts in %s",
  (locale) => {
    const i18n = createI18n(locale);
    render(
      <I18nextProvider i18n={i18n}>
        <AgentToolCard tool={TOOL} />
      </I18nextProvider>,
    );
    expect(screen.getByText(i18n.t("agentTools.status.ready"))).toBeTruthy();
    expect(screen.getByText(i18n.t("agentTools.processes"))).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: i18n.t("agentTools.actions.remove") })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(document.body.textContent).not.toContain("agentTools.");
  },
);

it("disables removal for active sessions", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentToolCard
        tool={{
          ...TOOL,
          activities: [
            { instanceId: "instance", processId: 4242, sessionId: "session" },
          ],
        }}
      />
    </I18nextProvider>,
  );
  expect(
    screen
      .getByRole("button", { name: "Verwaltete Installation entfernen" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText(/PID 4242/)).toBeTruthy();
});

it("shows the safe translated operation error", () => {
  fetcher.result = { ok: false, diagnostic: "permission_denied" };
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentToolCard tool={TOOL} />
    </I18nextProvider>,
  );
  expect(screen.getByRole("alert").textContent).toContain("Dateisystemrechte");
});

it("requires an explicit browser checkbox and stores it in the agent options", () => {
  const onChange = vi.fn();
  const configuration = {
    ...emptyAgentConfiguration(),
    run: acpRunOptions("yolo", 0),
  };
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentRunOptionsFields
        configuration={configuration}
        provider="codex_cli"
        disabled={false}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  const checkbox = screen.getByRole("checkbox", {
    name: /Playwright/,
    checked: false,
  });
  expect(checkbox.getAttribute("checked")).toBeNull();
  fireEvent.click(checkbox);
  expect(onChange).toHaveBeenCalledWith({
    ...configuration,
    run: { ...configuration.run, browser: true },
  });
});

it("offers no browser grant in read-only mode", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <AgentRunOptionsFields
        configuration={{
          ...emptyAgentConfiguration(),
          run: acpRunOptions("read_only", 0),
        }}
        provider="codex_cli"
        disabled={false}
        onChange={() => undefined}
      />
    </I18nextProvider>,
  );
  expect(screen.queryByRole("checkbox", { name: /Playwright/ })).toBeNull();
});

it("disables every action while its mutation is pending", () => {
  fetcher.state = "submitting";
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentToolCard tool={TOOL} />
    </I18nextProvider>,
  );
  expect(
    screen
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  expect(screen.getByText("Aktion läuft…")).toBeTruthy();
});
