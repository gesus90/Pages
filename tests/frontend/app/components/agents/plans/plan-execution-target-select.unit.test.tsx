import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanExecutionTargetSelect,
  planTargetLabel,
} from "@/app/components/agents/plans/plan-execution-target-select";

import { i18n, renderTranslated } from "./plan-flow-fixture";

import type {
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
} from "@/definition/AgentPlanExecution";

const NAS: AgentPlanRemoteTarget = {
  kind: "remote",
  connectionId: "nas",
  connectionRevision: 2,
  connectionName: "homeNAS",
  workspaceId: "pages",
  workspaceRevision: 4,
  workspaceName: "pageNAS",
  path: "/srv/pages",
};
const LOCAL: AgentPlanExecutionTarget = { kind: "local" };
const ON_NAS: AgentPlanExecutionTarget = {
  kind: "remote",
  workspaceId: "pages",
};
const GONE: AgentPlanExecutionTarget = { kind: "remote", workspaceId: "gone" };

const LOCAL_LABEL = i18n.t("plans.execution.local");
const UNAVAILABLE = i18n.t("plans.execution.unavailable");

function renderSelect(
  target: AgentPlanExecutionTarget | undefined,
  planTarget: AgentPlanExecutionTarget | undefined,
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderTranslated(
    <PlanExecutionTargetSelect
      id="target"
      target={target}
      planTarget={planTarget}
      choices={[NAS]}
      onChange={onChange}
    />,
  );
  return onChange;
}

function picker(): HTMLElement {
  return screen.getByRole("combobox", {
    name: i18n.t("plans.execution.target"),
  });
}

async function choose(option: string): Promise<void> {
  fireEvent.keyDown(picker(), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function inherit(target: string): string {
  return i18n.t("plans.execution.inherit", { target });
}

it("names the Pages host, a registered workspace and a target that is gone", () => {
  const translate = i18n.t.bind(i18n);

  expect(planTargetLabel(undefined, [NAS], translate)).toBe(LOCAL_LABEL);
  expect(planTargetLabel(LOCAL, [NAS], translate)).toBe(LOCAL_LABEL);
  expect(planTargetLabel(ON_NAS, [NAS], translate)).toBe("pageNAS · homeNAS");
  expect(planTargetLabel(GONE, [NAS], translate)).toBe(UNAVAILABLE);
});

it("follows a local plan target without a deviation or a remote hint", () => {
  renderSelect(undefined, undefined);

  expect(picker().textContent).toBe(inherit(LOCAL_LABEL));
  expect(
    screen.getByText(i18n.t("plans.execution.target")).getAttribute("for"),
  ).toBe("target");
  expect(screen.queryByText(i18n.t("plans.execution.deviation"))).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("warns that an inherited remote plan target needs a released runner", () => {
  renderSelect(undefined, ON_NAS);

  expect(picker().textContent).toBe(inherit("pageNAS · homeNAS"));
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.execution.remoteHint"),
  );
  expect(screen.queryByText(i18n.t("plans.execution.deviation"))).toBeNull();
});

it("marks an own local target under a remote plan target as a deviation", () => {
  renderSelect(LOCAL, ON_NAS);

  expect(picker().textContent).toBe(LOCAL_LABEL);
  expect(screen.getByText(i18n.t("plans.execution.deviation"))).toBeDefined();
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows an own remote target equal to the plan target without a deviation", () => {
  renderSelect(ON_NAS, ON_NAS);

  expect(picker().textContent).toBe("pageNAS · homeNAS");
  expect(screen.queryByText(i18n.t("plans.execution.deviation"))).toBeNull();
  expect(screen.getByRole("status")).toBeDefined();
});

it("keeps a removed own workspace visible as an unavailable choice", async () => {
  renderSelect(GONE, undefined);

  expect(picker().textContent).toBe(UNAVAILABLE);
  expect(screen.getByText(i18n.t("plans.execution.deviation"))).toBeDefined();
  fireEvent.keyDown(picker(), { key: "Enter" });
  const gone = await screen.findByRole("option", { name: UNAVAILABLE });

  expect(gone.getAttribute("aria-disabled")).toBe("true");
});

it("lists each registered workspace with its path", async () => {
  renderSelect(undefined, undefined);

  fireEvent.keyDown(picker(), { key: "Enter" });

  expect(
    (await screen.findByRole("option", { name: "pageNAS · homeNAS" }))
      .textContent,
  ).toBe("pageNAS · homeNAS/srv/pages");
});

it.each<{
  readonly option: string;
  readonly expected: AgentPlanExecutionTarget;
}>([
  { option: LOCAL_LABEL, expected: LOCAL },
  { option: "pageNAS · homeNAS", expected: ON_NAS },
])("chooses $option as the node's own target", async ({ option, expected }) => {
  const onChange = renderSelect(undefined, undefined);

  await choose(option);

  expect(onChange).toHaveBeenCalledWith(expected);
});

it("returns a node to the plan target", async () => {
  const onChange = renderSelect(LOCAL, undefined);

  await choose(inherit(LOCAL_LABEL));

  expect(onChange).toHaveBeenCalledWith(undefined);
});
