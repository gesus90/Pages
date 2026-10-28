import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentRow } from "@/app/components/agents/definitions/page-agent-row";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { i18n, pageAgent, renderAgentRoute } from "./page-agent-fixture";

import type { PageAgent } from "@/definition/PageAgent";

function renderRow(agent: PageAgent, onOpen = vi.fn()): HTMLElement[] {
  renderAgentRoute(
    <table>
      <tbody>
        <PageAgentRow agent={agent} onOpen={onOpen} />
      </tbody>
    </table>,
  );
  return within(screen.getByRole("row")).getAllByRole("cell");
}

function sharing(
  isGlobal: boolean,
  groups: readonly string[],
): PageAgent["configuration"] {
  return {
    ...emptyAgentConfiguration(),
    sharing: {
      isGlobal,
      targets: groups.map((targetId) => ({ kind: "group", targetId })),
    },
  };
}

it.each([
  ["pageAgents.global", sharing(true, ["team"])],
  ["pageAgents.restricted", sharing(false, ["team"])],
  ["pageAgents.private", sharing(false, [])],
])("names the sharing %s", (key, configuration) => {
  const [, , sharingCell] = renderRow(pageAgent({ configuration }));

  expect(sharingCell?.textContent).toBe(i18n.t(key));
});

it("lists a ready agent with its model and the default reasoning", () => {
  const [model, reasoning, , status] = renderRow(pageAgent());

  expect(screen.getByRole("rowheader").textContent).toBe("Reviewer");
  expect(model?.textContent).toBe("claude-sonnet");
  expect(reasoning?.textContent).toBe(i18n.t("pageAgents.defaultReasoning"));
  expect(status?.textContent).toBe(i18n.t("pageAgents.ready"));
  expect(status?.firstElementChild?.className).toBe("text-success");
});

it("shows the chosen reasoning level", () => {
  const [, reasoning] = renderRow(pageAgent({ reasoningEffort: "high" }));

  expect(reasoning?.textContent).toBe("high");
});

it.each([
  ["name_taken", "settings.agents.error.name_taken"],
  ["accessDenied", "agentExecution.error.accessDenied"],
] as const)("reports why an agent with reason %s cannot run", (reason, key) => {
  const [, , , status] = renderRow(
    pageAgent({
      availability: { isUsable: false, reason, personalChoices: [] },
    }),
  );

  expect(status?.textContent).toBe(i18n.t(key));
  expect(status?.firstElementChild?.className).toBe("text-warning");
});

it("opens an agent the person may only read without offering removal", () => {
  const onOpen = vi.fn();
  renderRow(pageAgent({ canEdit: false }), onOpen);

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("pageAgents.view") }),
  );

  expect(onOpen).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: i18n.t("settings.agents.remove") }),
  ).toBeNull();
});

it("opens the deletion of an own agent and closes it again", () => {
  renderRow(pageAgent());

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.remove") }),
  );
  expect(screen.getByRole("dialog")).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );

  expect(screen.queryByRole("dialog")).toBeNull();
});
