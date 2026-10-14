import { expect, it } from "vitest";

import {
  handleDiscordAction,
  toDiscordFailure,
} from "@/app/lib/discord-actions.server";
import { DiscordError } from "@/backend/error/DiscordErrors";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import {
  BASE_URL,
  DiscordWorld,
} from "../../backend/service/discord/discord-world";

import type { DiscordActionResult } from "@/definition/Discord";
import type { User } from "@/definition/User";

function run(
  world: DiscordWorld,
  fields: Record<string, string>,
  actor: User = world.owner,
): Promise<DiscordActionResult> {
  return handleDiscordAction({
    actor,
    formData: toForm(fields),
    projectId: "alpha",
    requestOrigin: BASE_URL,
    services: { discordConnectionService: world.service },
  });
}

function toForm(fields: Record<string, string>): FormData {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }

  return form;
}

function stateOf(
  result: DiscordActionResult,
): NonNullable<Extract<DiscordActionResult, { ok: true }>["state"]> {
  if (!result.ok) {
    throw new Error(`Unexpected failure ${result.error}`);
  }

  return result.state;
}

it("starts an attempt and answers with the official link", async () => {
  const world = new DiscordWorld();
  const result = await run(world, { intent: "start" });

  expect(stateOf(result).attempt).toMatchObject({ status: "pending" });
  expect(stateOf(result).attempt?.authorizeUrl).toContain(
    "https://discord.com/oauth2/authorize",
  );
});

it("confirms the connection with the attempt and the channel of the form", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300", name: "Team server" });

  const { callback } = await world.startAndAuthorize("300");

  await world.authorization.complete(callback);

  const attempt = await world.attempts.findLatestAttempt("alpha", "owner");
  const result = await run(world, {
    attemptId: attempt?.id ?? "",
    channelId: "201",
    intent: "confirm",
  });

  expect(stateOf(result).connection).toMatchObject({
    channelId: "201",
    guildName: "Team server",
  });
});

it("rejects incomplete forms before any service is asked", async () => {
  const world = new DiscordWorld();

  const forms: Record<string, string>[] = [
    { intent: "confirm" },
    { attemptId: "a", intent: "confirm" },
    { channelId: "c", intent: "confirm" },
    { intent: "channel" },
    { intent: "cancel" },
    { intent: "unknown" },
    {},
  ];

  for (const fields of forms) {
    await expect(run(world, fields)).resolves.toEqual({
      error: "invalid_input",
      ok: false,
    });
  }
});

it("reads each event switch on its own and treats a missing one as off", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  const result = await run(world, {
    intent: "events",
    "milestone.updated": "on",
    "ticket.created": "on",
    "ticket.updated": "",
  });

  expect(stateOf(result).connection?.events).toEqual({
    "milestone.created": false,
    "milestone.updated": true,
    "ticket.created": true,
    "ticket.updated": false,
  });
});

it("changes the channel, sends the test and disconnects", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  const changed = await run(world, { channelId: "201", intent: "channel" });
  const tested = await run(world, { intent: "test" });
  const disconnected = await run(world, { intent: "disconnect" });

  expect(stateOf(changed).connection?.channelId).toBe("201");
  expect(tested).toMatchObject({
    ok: true,
    test: { isSent: true, problem: null },
  });
  expect(stateOf(disconnected).connection).toBeNull();
});

it("cancels an attempt", async () => {
  const world = new DiscordWorld();
  const started = stateOf(await run(world, { intent: "start" }));
  const result = await run(world, {
    attemptId: started.attempt?.id ?? "",
    intent: "cancel",
  });

  expect(stateOf(result).attempt).toBeNull();
});

it("refuses a reader at the service and maps the refusal to a forbidden answer", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  const failure = await run(
    world,
    { intent: "disconnect" },
    world.reader,
  ).catch(toDiscordFailure);

  expect(failure).toEqual({
    result: { error: "forbidden", ok: false },
    status: 403,
  });
  expect(world.connections.rows.has("alpha")).toBe(true);
});

it("maps every refusal to a code and a status without any detail", () => {
  expect(toDiscordFailure(new ProjectManagementDeniedError())).toEqual({
    result: { error: "forbidden", ok: false },
    status: 403,
  });
  expect(toDiscordFailure(new ProjectAccessDeniedError()).status).toBe(403);
  expect(toDiscordFailure(new ProjectNotFoundError())).toEqual({
    result: { error: "not_found", ok: false },
    status: 404,
  });

  const statuses = {
    attempt_invalid: 409,
    channel_unavailable: 409,
    discord_unavailable: 502,
    invalid_events: 400,
    not_configured: 409,
    not_connected: 409,
  } as const;

  for (const [code, status] of Object.entries(statuses)) {
    const failure = toDiscordFailure(
      new DiscordError(code as keyof typeof statuses),
    );

    expect(failure).toEqual({ result: { error: code, ok: false }, status });
  }
});

it("does not swallow failures it does not know", () => {
  expect(() => toDiscordFailure(new Error("database exploded"))).toThrow(
    "database exploded",
  );
  expect(DEFAULT_DISCORD_EVENTS["ticket.created"]).toBe(true);
});
