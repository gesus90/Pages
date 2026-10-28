import { expect, it } from "vitest";

import { emptyAgentPlan } from "@/definition/AgentPlan";

it("creates a private plan without workspace, project or nodes", () => {
  expect(emptyAgentPlan()).toEqual({
    name: "",
    workspaceId: "",
    usage: "private",
    sharing: { isGlobal: false, targets: [], operator: "or" },
    projectId: "",
    globals: {},
    nodes: [],
    edges: [],
  });
});
