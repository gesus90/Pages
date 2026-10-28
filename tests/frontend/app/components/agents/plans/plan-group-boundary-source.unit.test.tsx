import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanGroupBoundarySource } from "@/app/components/agents/plans/plan-group-boundary-source";

import {
  GROUP_SOURCES,
  i18n,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type * as SelectModule from "@/app/components/ui/select";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

// The real select, recording its change callbacks so a late change can be replayed.
const valueChanges = vi.hoisted(() => {
  const changes: ((value: string) => void)[] = [];
  return changes;
});
vi.mock("@/app/components/ui/select", async (importOriginal) => {
  const actual = await importOriginal<typeof SelectModule>();
  function Select(
    props: React.ComponentProps<typeof actual.Select>,
  ): React.ReactElement {
    valueChanges.push(props.onValueChange);
    return <actual.Select {...props} />;
  }
  return { ...actual, Select };
});

const PORT = {
  id: "port",
  name: "ticket",
  type: "ticket" as const,
  description: "",
  isRequired: true,
  defaultValue: null,
};

function renderSource(
  group: AgentPlanGroup,
  disabled: boolean,
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderTranslated(
    <PlanGroupBoundarySource
      group={group}
      port={PORT}
      draft={planOf([
        { id: "ticket", type: "task", x: 0, y: 0, taskId: "task-1" },
        { id: "start", type: "start", x: 0, y: 0 },
      ])}
      sources={GROUP_SOURCES}
      disabled={disabled}
      onChange={onChange}
    />,
  );
  return onChange;
}

it("binds the chosen ticket source and keeps the other bindings", () => {
  const group = sessionGroup({
    parameters: [PORT],
    bindings: { kept: { kind: "source", nodeId: "start" } },
  });
  const onChange = renderSource(group, false);
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("plans.groups.externalSource", { name: "ticket" }),
    }).textContent,
  ).toBe(i18n.t("plans.useDefault"));
  valueChanges.at(-1)?.("ticket");
  expect(onChange).toHaveBeenCalledWith({
    ...group,
    bindings: {
      kept: { kind: "source", nodeId: "start" },
      ticket: { kind: "source", nodeId: "ticket" },
    },
  });
});

it("ignores a change that arrives while the source is locked", () => {
  const onChange = renderSource(sessionGroup({ parameters: [PORT] }), true);
  valueChanges.at(-1)?.("ticket");
  expect(onChange).not.toHaveBeenCalled();
});
