import { expect, it } from "vitest";

import { employeeAcpRunner } from "@/backend/service/chat/acp/EmployeeAcpRunners";

import { modelWorld, ZEN } from "./page347-model-fixture";

const selection = {
  connectionId: "connection",
  model: ZEN.id,
  reasoningEffort: null,
};

it.each(["workspace", "yolo"] as const)(
  "accepts free Zen on save and start with %s access",
  async (access) => {
    const { models } = modelWorld();
    const settings = { ...selection, access };
    const saved = await models.requireAllowed("admin", settings);
    const started = await models.resolve(settings);
    expect(saved.model).toBe(ZEN.id);
    expect(started).toEqual(saved);
    const runner = employeeAcpRunner(started, access);
    expect(runner.hasBridgeMcp).toBe(true);
    expect(runner.runOptions(started).access).toBe("yolo");
    expect(runner.isUnisolated).toBe(access === "yolo");
  },
);

it("lists all configured providers including models the employee cannot run", async () => {
  const { models } = modelWorld();
  const listed = await models.models("admin");
  expect(listed.map((entry) => entry.provider)).toEqual(["opencode", "openai"]);
  expect(listed[0].isFree).toBe(true);
});

it.each([
  { connectionId: "connection", access: "read_only" },
  { connectionId: "api", access: "workspace" },
] as const)(
  "rejects an unsupported $connectionId model with $access access on save and start",
  async (input) => {
    const { models } = modelWorld();
    const settings = { ...selection, ...input };
    await expect(
      models.requireAllowed("admin", settings),
    ).rejects.toMatchObject({ code: "modelNotAllowed" });
    await expect(models.resolve(settings)).rejects.toMatchObject({
      code: "modelNotAllowed",
    });
  },
);
