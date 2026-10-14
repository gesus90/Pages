import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { DiscordError } from "@/backend/error/DiscordErrors";
import { DiscordAuthorizationService } from "@/backend/service/discord/DiscordAuthorizationService";

import { MemoryAttemptStore } from "./discord-memory-stores";
import { BASE_URL, DiscordWorld } from "./discord-world";
import { APPLICATION } from "./fake-discord";

function hashOf(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

it("builds the official install link with the code grant and the minimal permissions", async () => {
  const world = new DiscordWorld();
  const { state } = await world.startAndAuthorize();
  const link = new URL(state.attempt?.authorizeUrl ?? "");

  expect(`${link.origin}${link.pathname}`).toBe(
    "https://discord.com/oauth2/authorize",
  );
  expect(link.searchParams.get("client_id")).toBe(APPLICATION.applicationId);
  expect(link.searchParams.get("scope")).toBe("bot");
  expect(link.searchParams.get("response_type")).toBe("code");
  // View Channel (1024) plus Send Messages (2048): nothing else is requested.
  expect(link.searchParams.get("permissions")).toBe("3072");
  expect(link.searchParams.get("redirect_uri")).toBe(
    `${BASE_URL}/discord/callback`,
  );
  expect(world.stateOf(state)).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it("stores only a hash of the state and binds the attempt to the user and the project", async () => {
  const world = new DiscordWorld();
  const { state } = await world.startAndAuthorize();
  const secret = world.stateOf(state);
  const [row] = [...world.attempts.rows.values()];

  expect(row).toMatchObject({
    projectId: "alpha",
    status: "pending",
    stateHash: hashOf(secret),
    userId: "owner",
  });
  expect(JSON.stringify(row)).not.toContain(secret);
  expect(row?.expiresAt).toBe("2026-10-15T10:15:01.000Z");
});

it("shows the install link only in the answer that started the attempt", async () => {
  const world = new DiscordWorld();

  await world.startAndAuthorize();

  const reloaded = await world.service.getState(world.owner, "alpha");

  expect(reloaded.attempt).toMatchObject({
    authorizeUrl: null,
    status: "pending",
  });
});

it("accepts the callback of another device without a Pages session and connects nothing yet", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300", name: "Team server" });

  const { callback } = await world.startAndAuthorize("300");

  await expect(world.authorization.complete(callback)).resolves.toBe(
    "authorized",
  );

  const state = await world.service.getState(world.owner, "alpha");

  expect(state.attempt).toMatchObject({
    guild: { id: "300", name: "Team server" },
    status: "authorized",
  });
  expect(state.connection).toBeNull();
  expect(world.connections.rows.size).toBe(0);
});

it("uses the state exactly once", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const { callback } = await world.startAndAuthorize("300");

  await expect(world.authorization.complete(callback)).resolves.toBe(
    "authorized",
  );
  await expect(world.authorization.complete(callback)).resolves.toBe("used");
});

it("rejects a state that is unknown, tampered with, missing or oversized", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const { callback } = await world.startAndAuthorize("300");
  const flipped = `${callback.state.slice(0, -1)}${callback.state.endsWith("A") ? "B" : "A"}`;

  for (const state of [flipped, "unknown", "", null, "x".repeat(500)]) {
    await expect(
      world.authorization.complete({ ...callback, state }),
    ).resolves.toBe("invalid");
  }

  // None of the attempts was spent, so the real state still works.
  await expect(world.authorization.complete(callback)).resolves.toBe(
    "authorized",
  );
});

it("rejects an expired state and an expired confirmation", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const { callback } = await world.startAndAuthorize("300");

  world.advance(16 * 60 * 1000);

  await expect(world.authorization.complete(callback)).resolves.toBe("expired");

  const second = new DiscordWorld();

  second.discord.addGuild({ id: "300" });

  const started = await second.startAndAuthorize("300");

  await second.authorization.complete(started.callback);
  second.advance(16 * 60 * 1000);

  const attempt = await second.attempts.findLatestAttempt("alpha", "owner");

  await expect(
    second.service.confirmConnection(second.owner, "alpha", {
      attemptId: attempt?.id ?? "",
      channelId: "201",
    }),
  ).rejects.toMatchObject({ code: "attempt_invalid" });
  expect(
    (await second.service.getState(second.owner, "alpha")).attempt,
  ).toMatchObject({ status: "expired" });
});

it("ends an attempt whose authorization Discord denied", async () => {
  const world = new DiscordWorld();
  const { callback } = await world.startAndAuthorize();

  await expect(
    world.authorization.complete({
      code: null,
      error: "access_denied",
      guildId: null,
      state: callback.state,
    }),
  ).resolves.toBe("denied");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "denied", status: "failed" });
});

it("fails without the code", async () => {
  const world = new DiscordWorld();
  const { callback } = await world.startAndAuthorize();

  await expect(
    world.authorization.complete({ ...callback, code: null }),
  ).resolves.toBe("failed");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "exchange_failed" });
});

it("fails when Discord does not accept the code", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const { callback } = await world.startAndAuthorize("300");

  await expect(
    world.authorization.complete({ ...callback, code: "forged-code" }),
  ).resolves.toBe("failed");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "exchange_failed" });
});

it("does not trust a server id in the callback that the token response contradicts", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300", name: "Granted" });
  world.discord.addGuild({ id: "301", name: "Other" });

  const { callback } = await world.startAndAuthorize("300");

  await expect(
    world.authorization.complete({ ...callback, guildId: "301" }),
  ).resolves.toBe("failed");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "verification_failed" });
});

it("verifies on the server that the bot is a member of the named server", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300", hasBot: false });

  const { callback } = await world.startAndAuthorize("300");

  await expect(world.authorization.complete(callback)).resolves.toBe("failed");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "verification_failed", guild: null });
});

it("fails when neither the callback nor the token response names a server", async () => {
  const world = new DiscordWorld();
  const { callback } = await world.startAndAuthorize();

  world.discord.scripted.push({
    body: { access_token: "synthetic-access-token", token_type: "Bearer" },
    status: 200,
  });

  await expect(
    world.authorization.complete({ ...callback, guildId: null }),
  ).resolves.toBe("failed");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "no_guild" });
});

it("confirms only for the user and the project that started the attempt", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });
  world.projects.get("alpha")?.writers.add("stranger");
  world.projects.get("alpha")?.readers.add("stranger");

  const { callback } = await world.startAndAuthorize("300");

  await world.authorization.complete(callback);

  const attempt = await world.attempts.findLatestAttempt("alpha", "owner");
  const attemptId = attempt?.id ?? "";

  await expect(
    world.service.confirmConnection(world.stranger, "alpha", {
      attemptId,
      channelId: "201",
    }),
  ).rejects.toMatchObject({ code: "attempt_invalid" });
  await expect(
    world.service.confirmConnection(world.owner, "beta", {
      attemptId,
      channelId: "201",
    }),
  ).rejects.toMatchObject({ code: "attempt_invalid" });
  expect(world.connections.rows.size).toBe(0);
});

it("lets an attempt be confirmed exactly once", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const { callback } = await world.startAndAuthorize("300");

  await world.authorization.complete(callback);

  const attempt = await world.attempts.findLatestAttempt("alpha", "owner");
  const confirmation = { attemptId: attempt?.id ?? "", channelId: "201" };

  await world.service.confirmConnection(world.owner, "alpha", confirmation);

  await expect(
    world.service.confirmConnection(world.owner, "alpha", confirmation),
  ).rejects.toBeInstanceOf(DiscordError);
});

it("cancels the earlier open attempt of the same user when a new one starts", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const first = await world.startAndAuthorize("300");
  const second = await world.service.startConnection(world.owner, {
    projectId: "alpha",
    requestOrigin: BASE_URL,
  });

  await expect(world.authorization.complete(first.callback)).resolves.toBe(
    "invalid",
  );
  expect(world.stateOf(second)).not.toBe(first.callback.state);
});

it("lets a person abandon the attempt", async () => {
  const world = new DiscordWorld();
  const { state } = await world.startAndAuthorize();
  const attemptId = state.attempt?.id ?? "";

  const after = await world.service.cancelAttempt(
    world.owner,
    "alpha",
    attemptId,
  );

  expect(after.attempt).toBeNull();
});

it("explains a missing Discord application instead of asking for credentials", async () => {
  const attempts = new MemoryAttemptStore();
  const authorization = new DiscordAuthorizationService({
    attempts,
    runtime: null,
  });

  await expect(
    authorization.start({
      baseUrl: BASE_URL,
      projectId: "alpha",
      userId: "owner",
    }),
  ).rejects.toMatchObject({ code: "not_configured" });
  await expect(
    authorization.complete({
      code: "c",
      error: null,
      guildId: "1",
      state: "s",
    }),
  ).resolves.toBe("not_configured");
});

it("never trusts a server id that only the address of the callback names", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300", name: "Victim server" });

  const { callback } = await world.startAndAuthorize("300");

  // Discord's answer names no server, so only the browser's claim is left.
  world.discord.scripted.push({
    body: { access_token: "synthetic-access-token", token_type: "Bearer" },
    status: 200,
  });

  await expect(world.authorization.complete(callback)).resolves.toBe("failed");
  expect(
    (await world.service.getState(world.owner, "alpha")).attempt,
  ).toMatchObject({ failure: "no_guild", guild: null });
});

it("does not revive an attempt that was cancelled while Discord was being asked", async () => {
  const world = new DiscordWorld();

  world.discord.addGuild({ id: "300" });

  const { callback, state } = await world.startAndAuthorize("300");
  const attemptId = state.attempt?.id ?? "";

  // The person presses "Cancel" while the phone's callback is still in flight.
  world.discord.duringRequest = async (url) => {
    if (url.endsWith("/oauth2/token")) {
      world.discord.duringRequest = null;
      await world.service.cancelAttempt(world.owner, "alpha", attemptId);
    }
  };

  await expect(world.authorization.complete(callback)).resolves.toBe("invalid");
  expect((await world.attempts.findAttempt(attemptId))?.status).toBe(
    "cancelled",
  );
  await expect(
    world.service.confirmConnection(world.owner, "alpha", {
      attemptId,
      channelId: "201",
    }),
  ).rejects.toMatchObject({ code: "attempt_invalid" });
  expect(world.connections.rows.size).toBe(0);
});

it("does not let a failure overwrite an attempt that was replaced meanwhile", async () => {
  const world = new DiscordWorld();
  const { callback, state } = await world.startAndAuthorize("300");
  const attemptId = state.attempt?.id ?? "";

  world.discord.duringRequest = async (url) => {
    if (url.endsWith("/oauth2/token")) {
      world.discord.duringRequest = null;
      await world.service.cancelAttempt(world.owner, "alpha", attemptId);
    }
  };

  // The code is unknown to Discord, so the exchange fails.
  await expect(
    world.authorization.complete({ ...callback, code: "forged" }),
  ).resolves.toBe("invalid");
  expect((await world.attempts.findAttempt(attemptId))?.status).toBe(
    "cancelled",
  );
});
