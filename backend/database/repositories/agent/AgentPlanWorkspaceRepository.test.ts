import { expect, it, vi } from "vitest";

import { AgentPlanWorkspaceRepository } from "./AgentPlanWorkspaceRepository";

it("returns the identifiers of local and remote workspaces as a set", async () => {
  const query = vi.fn(async () => [["w1"], ["w2"], ["w1"]]);

  const ids = await new AgentPlanWorkspaceRepository({ query }).registeredIds();

  expect([...ids]).toEqual(["w1", "w2"]);
});
