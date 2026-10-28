import { randomUUID } from "node:crypto";

import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  readDraftRequest,
  runDraftWrite,
} from "@/app/lib/drafts/draft-request.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({ marker: "services" }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const ACTOR: User = {
  id: "owner",
  username: "owner",
  displayName: "Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const TEXT_SCHEMA = z.object({ text: z.string() });

beforeEach(() => {
  vi.mocked(logCaughtError).mockClear();
});

function draftArguments(request: Request): {
  readonly request: Request;
  readonly context: RouterContextProvider;
} {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, ACTOR);
  return { request, context };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://pages.example/draft", {
    method: "POST",
    headers,
    body,
  });
}

it("returns the validated order with actor and services", async () => {
  const streamId = randomUUID();
  const body = JSON.stringify({
    streamId,
    sequence: 3,
    base: { text: "old" },
    draft: { text: "new" },
  });

  await expect(
    readDraftRequest(draftArguments(post(body)), TEXT_SCHEMA),
  ).resolves.toEqual({
    streamId,
    sequence: 3,
    base: { text: "old" },
    draft: { text: "new" },
    actor: ACTOR,
    services,
  });
});

it("refuses another method, a missing account and a foreign origin", async () => {
  const put = new Request("https://pages.example/draft", { method: "PUT" });
  const anonymous = {
    request: post("{}"),
    context: new RouterContextProvider(),
  };
  const foreign = post("{}", { Origin: "https://foreign.example" });

  const method = readDraftRequest(draftArguments(put), TEXT_SCHEMA);
  await expect(method).rejects.toMatchObject({ status: 405 });
  await expect(readDraftRequest(anonymous, TEXT_SCHEMA)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    readDraftRequest(draftArguments(foreign), TEXT_SCHEMA),
  ).rejects.toMatchObject({ status: 403 });
});

it("refuses an order whose drafts do not match the schema", async () => {
  const body = JSON.stringify({
    streamId: randomUUID(),
    sequence: 1,
    base: { text: 1 },
    draft: { text: "new" },
  });
  const sameOrigin = post(body, { Origin: "https://pages.example" });

  await expect(
    readDraftRequest(draftArguments(sameOrigin), TEXT_SCHEMA),
  ).rejects.toMatchObject({ status: 400 });
});

it("passes on a body failure that is not malformed JSON", async () => {
  const request = post("{}");
  await request.text();

  const reading = readDraftRequest(draftArguments(request), TEXT_SCHEMA);

  await expect(reading).rejects.toBeInstanceOf(TypeError);
  expect(logCaughtError).toHaveBeenCalledWith(
    "draft_request",
    expect.any(TypeError),
  );
});

it("answers malformed JSON with a logged 400", async () => {
  await expect(
    readDraftRequest(draftArguments(post("{")), TEXT_SCHEMA),
  ).rejects.toMatchObject({ status: 400 });
  expect(logCaughtError).toHaveBeenCalledWith(
    "draft_request",
    expect.any(SyntaxError),
  );
});

function order(sequence: number): {
  readonly actorId: string;
  readonly objectId: string;
  readonly streamId: string;
  readonly sequence: number;
} {
  return {
    actorId: "owner",
    objectId: "page",
    streamId: "stream-draft-request",
    sequence,
  };
}

it("runs a newer write and answers a superseded one with 409", async () => {
  const work = vi.fn(async () => new Response("saved"));

  expect(await (await runDraftWrite(order(2), work)).text()).toBe("saved");
  const stale = await runDraftWrite(order(1), work);

  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ ok: false, error: "superseded" });
  expect(work).toHaveBeenCalledOnce();
});

it("passes on any other failure of the write", async () => {
  const failure = new Error("storage failed");

  await expect(
    runDraftWrite(order(5), async () => Promise.reject(failure)),
  ).rejects.toBe(failure);
  expect(logCaughtError).toHaveBeenCalledWith("draft_request", failure);
});
