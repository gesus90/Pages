import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

import {
  localSessionSocket,
  sendLocalCommand,
} from "@/backend/agents/local/LocalSessionTransport";
import { localOwnerManifestSchema } from "@/backend/agents/local/LocalSessionContracts";
import { AgentError } from "@/backend/error/AgentErrors";
import { LocalControlCommandError } from "@/backend/agents/local/LocalControlFailure";

import type { LocalOwnerManifest } from "@/backend/agents/local/LocalSessionContracts";

class FakeResponse extends EventEmitter {
  public statusCode: number | undefined = 200;
  public setEncoding = vi.fn();
}

class FakeRequest extends EventEmitter {
  public destroy = vi.fn((error: Error) => {
    this.emit("error", error);
  });
  public setTimeout = vi.fn((milliseconds: number, handler: () => void) => {
    this.timeout = milliseconds;
    this.onTimeout = handler;
  });
  public end = vi.fn();
  public timeout = 0;
  public onTimeout: () => void = () => undefined;
}

interface HttpState {
  options: unknown;
  respond: ((response: unknown) => void) | null;
  outgoing: unknown;
}

const http: HttpState = vi.hoisted(() => ({
  options: null,
  respond: null,
  outgoing: null,
}));
const UUID = "11111111-1111-4111-8111-111111111111";
const log = vi.hoisted(() => vi.fn());

vi.mock("node:http", () => ({
  request: (options: unknown, listener: (response: unknown) => void) => {
    http.options = options;
    http.respond = listener;
    return http.outgoing;
  },
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: log }));

const manifest: LocalOwnerManifest = localOwnerManifestSchema.parse({
  version: 1,
  instanceKey: "a".repeat(64),
  capability: "c".repeat(64),
  configPath: "/config",
  directory: "/directory",
  unit: `pages-local-${UUID}.service`,
  launch: {
    runId: UUID,
    stepId: "step",
    sessionScopeId: "scope",
    attemptId: UUID,
    turnId: UUID,
    isInstruction: false,
    instanceId: UUID,
    userId: UUID,
    prompt: "p",
    instruction: "i",
    resumeSessionId: null,
    timeoutMinutes: 1,
    mcp: null,
  },
});

let outgoing = new FakeRequest();
beforeEach(() => {
  outgoing = new FakeRequest();
  http.outgoing = outgoing;
});

function start(attachment?: string): Promise<unknown> {
  return sendLocalCommand(manifest, { kind: "cancel" }, attachment);
}

function respond(statusCode: number | undefined): FakeResponse {
  const response = new FakeResponse();
  response.statusCode = statusCode;
  http.respond?.(response);
  return response;
}

it("derives a short private socket name per owner", () => {
  const socket = localSessionSocket(manifest);
  expect(socket).toMatch(/^\/run\/user\/\d+\/pages-local-[a-f0-9]{32}\.sock$/u);
  expect(localSessionSocket({ ...manifest, instanceKey: "other" })).not.toBe(
    socket,
  );
});

it("sends an authenticated command and parses the answer", async () => {
  const result = start("attached");
  const response = respond(200);
  response.emit("data", '{"ok":');
  response.emit("data", "true}");
  response.emit("end");
  await expect(result).resolves.toEqual({ ok: true });
  expect(outgoing.end).toHaveBeenCalledWith('{"kind":"cancel"}');
  expect(http.options).toMatchObject({
    method: "POST",
    path: "/",
    headers: {
      authorization: `Bearer ${manifest.capability}`,
      "x-pages-attachment": "attached",
    },
  });
});

it("sends an empty attachment header by default", async () => {
  const result = start();
  respond(200).emit("end");
  await expect(result).rejects.toThrow("Invalid local session control");
  expect(http.options).toMatchObject({
    headers: { "x-pages-attachment": "" },
  });
});

it("rejects an oversized response", async () => {
  const result = start();
  const response = respond(200);
  response.emit("data", "x".repeat(2 * 1024 * 1024 + 1));
  expect(outgoing.destroy).toHaveBeenCalledOnce();
  response.emit("data", "ignored");
  await expect(result).rejects.toBeInstanceOf(LocalControlCommandError);
});

it("maps a known owner code of a rejected command", async () => {
  const result = start();
  const response = respond(409);
  response.emit("data", '{"error":"stale_attachment"}');
  response.emit("end");
  await expect(result).rejects.toMatchObject({ detail: "stale_attachment" });
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: {
        operation: "cancel",
        statusCode: 409,
        code: "stale_attachment",
      },
    }),
  );
});

it.each([
  { label: "a non-object body", body: "5" },
  { label: "a null body", body: "null" },
  { label: "a malformed body", body: "{" },
])("falls back to internal for $label", async ({ body }) => {
  const result = start();
  const response = respond(500);
  response.emit("data", body);
  response.emit("end");
  await expect(result).rejects.toMatchObject({ detail: "internal" });
});

it.each([401, 403])(
  "reports an unverified owner for status %i",
  async (code) => {
    const result = start();
    respond(code).emit("end");
    const error: unknown = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentError);
    expect(error).not.toBeInstanceOf(LocalControlCommandError);
  },
);

it("fails closed when the response stream errors", async () => {
  const result = start();
  respond(502).emit("error", new Error("private"));
  await expect(result).rejects.toBeInstanceOf(LocalControlCommandError);
});

it("fails when the request errors, with or without a status", async () => {
  const early = start();
  outgoing.emit("error", new Error("private"));
  await expect(early).rejects.toMatchObject({ detail: "internal" });

  outgoing = new FakeRequest();
  http.outgoing = outgoing;
  const late = start();
  respond(undefined);
  outgoing.emit("error", new Error("private"));
  await expect(late).rejects.toBeInstanceOf(LocalControlCommandError);
});

it("destroys the request after the control timeout", async () => {
  const result = start();
  expect(outgoing.timeout).toBe(35_000);
  outgoing.onTimeout();
  expect(outgoing.destroy).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Local session control timed out" }),
  );
  await expect(result).rejects.toBeInstanceOf(LocalControlCommandError);
});
