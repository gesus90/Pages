import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loader as callback } from "@/app/routes/discord-callback";
import { loader as result } from "@/app/routes/discord-result";
import { action, loader } from "@/app/routes/project-discord";
import { APPLICATION } from "../../backend/service/discord/fake-discord";
import {
  BASE_URL,
  DiscordWorld,
} from "../../backend/service/discord/discord-world";

import type { DiscordActionResult } from "@/definition/Discord";
import type { User } from "@/definition/User";

const holder = vi.hoisted<{ services: unknown }>(() => ({
  services: undefined,
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => holder.services,
}));

let world: DiscordWorld;

beforeEach(() => {
  world = new DiscordWorld();
  holder.services = {
    discordAuthorizationService: world.authorization,
    discordConnectionService: world.service,
  };
});

function context(user: User | null): RouterContextProvider {
  const provider = new RouterContextProvider();

  provider.set(authenticatedUserContext, user);

  return provider;
}

function args(
  request: Request,
  user: User | null,
): {
  readonly request: Request;
  readonly context: RouterContextProvider;
  readonly params: { projectId: string };
  readonly url: URL;
  readonly pattern: string;
} {
  return {
    context: context(user),
    params: { projectId: "alpha" },
    pattern: "/projekte/:projectId/discord",
    request,
    url: new URL(request.url),
  };
}

async function post(
  fields: Record<string, string>,
  user: User | null = world.owner,
): Promise<{
  readonly response: Response;
  readonly body: DiscordActionResult;
}> {
  const response = await action(
    args(
      new Request(`${BASE_URL}/projekte/alpha/discord`, {
        body: new URLSearchParams(fields),
        method: "POST",
      }),
      user,
    ),
  );

  return { body: (await response.json()) as DiscordActionResult, response };
}

it("serves the state of the panel without caching it", async () => {
  await world.connectAlpha();

  const response = await loader(
    args(new Request(`${BASE_URL}/projekte/alpha/discord`), world.reader),
  );
  const body = (await response.json()) as DiscordActionResult;

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(body).toMatchObject({
    ok: true,
    state: { canManage: false, connection: { channelName: "general" } },
  });
  expect(JSON.stringify(body)).not.toContain(APPLICATION.botToken);
  expect(JSON.stringify(body)).not.toContain(APPLICATION.clientSecret);
});

it("lists the channels of the connected server only when asked", async () => {
  await world.connectAlpha();

  const response = await loader(
    args(
      new Request(`${BASE_URL}/projekte/alpha/discord?channels=1`),
      world.owner,
    ),
  );
  const body = (await response.json()) as DiscordActionResult;

  expect(body).toMatchObject({
    ok: true,
    state: { channels: [{ id: "201", isSelectable: true }] },
  });
});

it("answers a visitor without a session and a stranger with a refusal", async () => {
  const anonymous = await loader(
    args(new Request(`${BASE_URL}/projekte/alpha/discord`), null),
  );
  const stranger = await loader(
    args(new Request(`${BASE_URL}/projekte/alpha/discord`), world.stranger),
  );
  const missing = await loader({
    ...args(new Request(`${BASE_URL}/projekte/x/discord`), world.owner),
    params: { projectId: "x" },
  });

  expect(anonymous.status).toBe(403);
  expect(stranger.status).toBe(403);
  expect(await stranger.json()).toEqual({ error: "forbidden", ok: false });
  expect(missing.status).toBe(404);
});

it("runs an action for the signed-in user and refuses everything else", async () => {
  const started = await post({ intent: "start" });

  expect(started.response.status).toBe(200);
  expect(started.body).toMatchObject({ ok: true });

  const reader = await post({ intent: "start" }, world.reader);

  expect(reader.response.status).toBe(403);
  expect(reader.body).toEqual({ error: "forbidden", ok: false });

  const anonymous = await post({ intent: "start" }, null);

  expect(anonymous.response.status).toBe(403);

  const unknown = await post({ intent: "launch" });

  expect(unknown.response.status).toBe(400);
});

it("refuses any method but POST for actions", async () => {
  await expect(
    action(
      args(
        new Request(`${BASE_URL}/projekte/alpha/discord`, { method: "PUT" }),
        world.owner,
      ),
    ),
  ).rejects.toMatchObject({ status: 405 });
});

it("answers the callback with a redirect that carries neither the code nor the state", async () => {
  world.discord.addGuild({ id: "300", name: "Team server" });

  const { callback: query } = await world.startAndAuthorize("300");
  const address = new URL(`${BASE_URL}/discord/callback`);

  address.searchParams.set("state", query.state);
  address.searchParams.set("code", query.code);
  address.searchParams.set("guild_id", query.guildId);

  const response = await callback({
    ...args(new Request(address), null),
    params: {},
  });

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "/discord/result?outcome=authorized",
  );
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("no-store");

  // The second call with the same state is refused.
  const replay = await callback({
    ...args(new Request(address), null),
    params: {},
  });

  expect(replay.headers.get("Location")).toBe("/discord/result?outcome=used");
});

it("answers a callback with an error or without a state", async () => {
  const denied = await callback({
    ...args(
      new Request(`${BASE_URL}/discord/callback?error=access_denied&state=x`),
      null,
    ),
    params: {},
  });
  const bare = await callback({
    ...args(new Request(`${BASE_URL}/discord/callback`), null),
    params: {},
  });

  expect(denied.headers.get("Location")).toBe(
    "/discord/result?outcome=invalid",
  );
  expect(bare.headers.get("Location")).toBe("/discord/result?outcome=invalid");
});

it("accepts only known outcomes on the result page", () => {
  const outcomeOf = (query: string): string =>
    result({
      ...args(new Request(`${BASE_URL}/discord/result${query}`), null),
      params: {},
    }).outcome;

  expect(outcomeOf("?outcome=authorized")).toBe("authorized");
  expect(outcomeOf("?outcome=expired")).toBe("expired");
  expect(outcomeOf("?outcome=<script>")).toBe("invalid");
  expect(outcomeOf("")).toBe("invalid");
});
