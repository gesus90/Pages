import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "@/app/routes/api-v1-agents";

import {
  TEXT_TARGETS,
  TextWorld,
} from "../../backend/service/agents/page59-text-world";

const boundary = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: boundary.services,
}));

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
  world.seed("abc\ndef");
  boundary.services.mockResolvedValue({ pagesAgentApiService: world.api });
});

async function post(
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const url = new URL("https://pages.example/api/v1/agents");
  return action({
    request: new Request(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic-personal-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operation, parameters }),
    }),
    context: new RouterContextProvider(),
    params: {},
    url,
    pattern: "/api/v1/agents",
  });
}

describe.each(TEXT_TARGETS)("%s MCP-facing HTTP contract", (target) => {
  it("serves range reads and identical patch replays through the Agent API", async () => {
    const operation =
      target === "wiki" ? "wiki.page.patchContent" : "ticket.patchDescription";
    const read = await post(
      target === "wiki"
        ? "wiki.page.readRange"
        : "ticket.description.readRange",
      { ...world.target(target), start: { line: 1 }, maxCharacters: 2 },
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("no-store");
    expect(await read.json()).toMatchObject({
      apiVersion: "1",
      result: { text: "ab", truncated: true, next: { line: 1, column: 3 } },
    });
    const parameters = await world.patchParameters(target, {
      includeAfter: true,
    });
    const first = await post(operation, parameters);
    expect(first.status).toBe(200);
    const body: unknown = await first.json();
    expect(body).toMatchObject({
      apiVersion: "1",
      result: { changed: true, after: { text: "X" } },
    });
    const before = world.stored();
    const replay = await post(operation, parameters);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);
    expect(world.stored()).toEqual(before);
  });

  it("returns the stable conflict response without partial writes", async () => {
    const parameters = await world.patchParameters(target, {
      expectedText: "stale",
    });
    const before = world.stored();
    const response = await post(
      target === "wiki" ? "wiki.page.patchContent" : "ticket.patchDescription",
      parameters,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      apiVersion: "1",
      error: {
        code: "CONFLICT",
        retryable: false,
        details: { reason: "range_text_mismatch" },
      },
    });
    expect(world.stored()).toEqual(before);
  });

  it("rejects a patch JSON envelope above 64 KiB before dispatching it", async () => {
    const parameters = await world.patchParameters(target, {
      replacementText: "ä".repeat(33_000),
    });
    const dispatch = vi.spyOn(world.api, "handle");
    const before = world.stored();
    const response = await post(
      target === "wiki" ? "wiki.page.patchContent" : "ticket.patchDescription",
      parameters,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        details: { constraint: "requestBytes", limit: 65_536 },
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(world.stored()).toEqual(before);
  });
});

it("offers the four range operations alongside the existing full-text operations", async () => {
  const response = await post("verify", {});
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toHaveProperty("apiVersion", "1");
  expect(body).toHaveProperty(
    "tools",
    expect.arrayContaining([
      "wiki.page.readRange",
      "ticket.description.readRange",
      "wiki.page.patchContent",
      "ticket.patchDescription",
      "wiki.page.read",
      "wiki.page.setContent",
      "ticket.read",
      "ticket.setDescription",
    ]),
  );
});
