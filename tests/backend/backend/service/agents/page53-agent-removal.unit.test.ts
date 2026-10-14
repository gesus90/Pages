import { expect, it } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import { RemovalDatabase } from "./page53-removal-database";

it.each([false, true])(
  "deletes an otherwise unused agent with a single assignment: %s",
  async (hasAssignment) => {
    const database = new RemovalDatabase();
    database.scopes = hasAssignment ? ["removed", "other"] : ["other"];
    database.legacy = ["other"];
    await new AgentProfileRepository(
      database.asDatabase(),
    ).removeWithReferences("removed");
    expect(database.scopes).toEqual(["other"]);
    expect(database.profiles.map((profile) => profile.id)).toEqual(["other"]);
    expect(database.commits).toBe(1);
  },
);

it.each([0, 1, 3])(
  "removes an admin profile with %s dependent plans and agents while retaining linked records",
  async (count) => {
    const database = new RemovalDatabase();
    for (let index = 0; index < count; index += 1) database.link(index);
    const retained = structuredClone(database.retained);
    const plans = structuredClone(database.plans);
    const repository = new AgentProfileRepository(database.asDatabase());
    await repository.removeWithReferences("removed");
    expect(database.commits).toBe(1);
    expect(
      database.profiles.find((profile) => profile.id === "removed"),
    ).toBeUndefined();
    expect(database.profiles).toHaveLength(count + 1);
    expect(database.profiles[0]).toEqual({
      id: "other",
      ownerId: null,
      modelProfileId: null,
      revision: 1,
    });
    expect(database.scopes).toEqual(["other"]);
    expect(database.purposes).toEqual(["other"]);
    expect(database.legacy).toEqual(["other"]);
    expect(database.retained).toEqual(retained);
    expect(database.plans).toHaveLength(count);
    for (const [index, plan] of database.plans.entries()) {
      expect(plan.revision).toBe(5);
      expect(plan.input.nodes[0]).toEqual({
        ...plans[index].input.nodes[0],
        agentId: "",
        personalAgentId: "",
      });
      expect(plan.input.nodes.slice(1)).toEqual(
        plans[index].input.nodes.slice(1),
      );
      expect(plan.input.edges).toEqual(plans[index].input.edges);
      expect(planExecutionIssues(plan.input, [])).toContainEqual({
        nodeId: "step",
        port: null,
        reason: "agent",
      });
    }
    const profiles = await repository.list();
    for (const profile of profiles.filter(
      (entry) => entry.ownerId !== undefined,
    )) {
      expect(profile.modelProfileId).toBe("");
      expect(profile.revision).toBe(4);
    }
  },
);

it.each([1, 2, 3, 4, 5, 6, 7, 8])(
  "rolls back every change when write %s fails",
  async (failureAt) => {
    const database = new RemovalDatabase();
    for (let index = 0; index < 3; index += 1) database.link(index);
    const before = structuredClone({
      profiles: database.profiles,
      plans: database.plans,
      scopes: database.scopes,
      purposes: database.purposes,
      legacy: database.legacy,
      retained: database.retained,
    });
    database.failureAt = failureAt;
    await expect(
      new AgentProfileRepository(database.asDatabase()).removeWithReferences(
        "removed",
      ),
    ).rejects.toThrow("Synthetic write failure");
    expect(database).toMatchObject(before);
    expect(database.commits).toBe(0);
    expect(database.rollbacks).toBe(1);
  },
);

it.each(["unknown", "user-0"])(
  "refuses %s inside the transaction before modifying any records",
  async (id) => {
    const database = new RemovalDatabase();
    database.link(0);
    await expect(
      new AgentProfileRepository(database.asDatabase()).removeWithReferences(
        id,
      ),
    ).rejects.toMatchObject({
      code: id === "unknown" ? "profile_not_found" : "agent_usage_denied",
    });
    expect(database.executions).toBe(0);
    expect(database.commits).toBe(0);
  },
);
