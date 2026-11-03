import { expect, it, vi } from "vitest";

import { RuntimeToolDeniedError } from "@/backend/agents/runtime/RuntimeToolRegistry";

import { operatorWorld } from "../admin/pica-operator-world";
import { PicaJobWorld } from "./page103-job-fixture";

// The plan tools come from the independent MCP catalog, which Pages unit tests do not load.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));

/** A job whose person is the administrator of the given world. */
function administratorJob(
  world: ReturnType<typeof operatorWorld>,
): PicaJobWorld {
  return new PicaJobWorld("codex_cli", null, {
    adminTools: world.service,
    tools: world.tools,
  });
}

it("offers the agent session the administrator tools only for an administrator", async () => {
  const administrator = administratorJob(operatorWorld());
  const person = administratorJob(operatorWorld({ isAdmin: false }));

  await Promise.all([administrator.start(), person.start()]);

  const names = (job: PicaJobWorld): string[] =>
    job.catalog.map(({ id }) => id);
  expect(names(administrator)).toEqual(
    expect.arrayContaining(["projects_list", "list_admin_users"]),
  );
  expect(names(person)).toContain("projects_list");
  expect(names(person)).not.toContain("list_admin_users");
  expect(names(person)).not.toContain("admin_files_read");
  administrator.complete();
  person.complete();
});

it("refuses a person who is no administrator even when the tool name is guessed", async () => {
  const world = operatorWorld({ isAdmin: false });
  const job = administratorJob(world);
  await job.start();

  await expect(job.call("list_admin_users")).rejects.toBeInstanceOf(
    RuntimeToolDeniedError,
  );
  expect(world.router).not.toHaveBeenCalled();
  job.complete();
});

it("ends the job with a readable status when the administrator right is withdrawn", async () => {
  const world = operatorWorld();
  const job = administratorJob(world);
  const { completion } = await job.start();
  expect((await job.call("list_admin_users")).ok).toBe(true);

  world.person.isAdmin = false;

  await vi.waitFor(() =>
    expect(job.finish).toHaveBeenCalledWith("job", "failed", "adminRevoked"),
  );
  await completion;
  await expect(job.call("list_admin_users")).rejects.toThrow();
  expect(world.router).toHaveBeenCalledTimes(1);
});

it("ends an administrator job the person stops, without calling a service again", async () => {
  const world = operatorWorld();
  const job = administratorJob(world);
  const { completion } = await job.start();
  expect((await job.call("list_admin_users")).ok).toBe(true);

  job.job.stop();
  job.controller.abort();
  await completion;

  expect(job.finish).toHaveBeenCalledWith("job", "stopped", null);
  expect(world.router).toHaveBeenCalledTimes(1);
});
