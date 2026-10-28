import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanRemoteStatus } from "@/app/components/agents/plans/plan-remote-status";

import { i18n, renderTranslated } from "./plan-panel-fixture";

import type { AgentPlanRemoteStatus } from "@/definition/AgentPlanTarget";

const REMOTE = { kind: "remote", workspaceId: "remote" } as const;

function status(
  overrides: Partial<AgentPlanRemoteStatus> = {},
): AgentPlanRemoteStatus {
  return {
    workspaceId: "remote",
    problem: null,
    tools: [],
    hasModelCatalog: true,
    ...overrides,
  };
}

function lines(): readonly (string | null)[] {
  return [...screen.getByRole("status").querySelectorAll("p")].map(
    (line) => line.textContent,
  );
}

function toolLine(tool: string, reason: string, suffix = ""): string {
  return `${i18n.t(`settings.agents.runner.toolName.${tool}`)} · ${i18n.t(`settings.agents.runner.auth.${reason}`)}${suffix}`;
}

it("shows nothing for a local target or a remote one without reported facts", () => {
  const local = renderTranslated(
    <PlanRemoteStatus
      sources={{ agents: [], tasks: [], remoteStatus: [status()] }}
      target={{ kind: "local" }}
    />,
  );
  expect(local.container.textContent).toBe("");
  local.unmount();

  const unknown = renderTranslated(
    <PlanRemoteStatus sources={{ agents: [], tasks: [] }} target={REMOTE} />,
  );

  expect(unknown.container.textContent).toBe("");
});

it("names the problem of the runner, when its catalog was checked and where to fix it", () => {
  renderTranslated(
    <PlanRemoteStatus
      sources={{
        agents: [],
        tasks: [],
        remoteStatus: [
          status({
            problem: "remoteOffline",
            catalogCheckedAt: "2026-10-15T10:00:00Z",
          }),
        ],
      }}
      target={REMOTE}
    />,
  );

  expect(lines()).toEqual([
    i18n.t("plans.panel.issueCause.remoteOffline"),
    i18n.t("plans.communication.catalogChecked", {
      at: "2026-10-15T10:00:00Z",
    }),
    i18n.t("plans.execution.remotePause"),
  ]);
  expect(
    screen
      .getByRole("link", { name: i18n.t("plans.execution.runnerSettings") })
      .getAttribute("href"),
  ).toBe("/settings/agents");
});

it("separates installation, login and catalog of every tool", () => {
  renderTranslated(
    <PlanRemoteStatus
      sources={{
        agents: [],
        tasks: [],
        remoteStatus: [
          status({
            hasModelCatalog: false,
            tools: [
              {
                tool: "codex",
                version: "1.0.0",
                authentication: "authenticated",
              },
              {
                tool: "claude",
                version: "2.0.0",
                authentication: "authenticated",
                models: [
                  { id: "sonnet", name: "Sonnet", reasoningEfforts: [] },
                ],
              },
              { tool: "opencode", version: "1.2.0" },
            ],
          }),
        ],
      }}
      target={REMOTE}
    />,
  );
  const shown = lines();

  expect(shown[0]).toBe(
    toolLine(
      "codex",
      "authenticated",
      ` · ${i18n.t("plans.panel.issueCause.remoteCatalog")}`,
    ),
  );
  expect(shown[1]).toBe(toolLine("claude", "authenticated"));
  expect(shown[2]).toBe(
    `${toolLine("opencode", "unknown")}${i18n.t("settings.agents.runner.openCode.update")}`,
  );
  expect(shown[3]).toBe(i18n.t("plans.execution.catalogMissing"));
  expect(shown).toHaveLength(5);
});

it("names a tool that is not installed", () => {
  renderTranslated(
    <PlanRemoteStatus
      sources={{
        agents: [],
        tasks: [],
        remoteStatus: [
          status({
            hasOpenCodeAccess: true,
            tools: [
              { tool: "codex", version: null, authentication: "not_logged_in" },
            ],
          }),
        ],
      }}
      target={REMOTE}
    />,
  );

  expect(lines().slice(0, 3)).toEqual([
    toolLine("codex", "not_logged_in"),
    toolLine("claude", "missing"),
    toolLine("opencode", "missing"),
  ]);
});
