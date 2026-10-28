import { describe, expect, it } from "vitest";

import { readAgentJson } from "@/app/lib/agent-json.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { SYNTHETIC_ORIGIN } from "./request-fixtures";

const JSON_TYPE = "application/json";

function agentRequest(
  body: BodyInit | null,
  headers: Record<string, string> = { "content-type": JSON_TYPE },
): Request {
  return new Request(`${SYNTHETIC_ORIGIN}/api/v1/agents`, {
    body,
    headers,
    method: "POST",
  });
}

/** A JSON object of exactly the requested serialized size in bytes. */
function envelopeOfSize(
  bytes: number,
  extra: Record<string, unknown> = {},
): string {
  const base = JSON.stringify({ ...extra, padding: "" });
  const padding = "x".repeat(bytes - base.length);

  return JSON.stringify({ ...extra, padding });
}

async function failure(work: Promise<unknown>): Promise<AgentOperationError> {
  try {
    await work;
  } catch (error: unknown) {
    if (error instanceof AgentOperationError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected an agent operation error.");
}

describe("readAgentJson input checks", () => {
  it("reads a JSON object", async () => {
    const input = await readAgentJson(
      agentRequest('{"operation":"projects.list"}'),
    );

    expect(input).toEqual({ operation: "projects.list" });
  });

  it("accepts a content type with parameters", async () => {
    const request = agentRequest("{}", {
      "content-type": "application/json; charset=utf-8",
    });

    expect(await readAgentJson(request)).toEqual({});
  });

  it.each([
    ["a missing content type", {}],
    ["a text content type", { "content-type": "text/plain" }],
    ["a form content type", { "content-type": "multipart/form-data" }],
  ])("rejects %s", async (caseName, headers) => {
    const error = await failure(readAgentJson(agentRequest("{}", headers)));

    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.status).toBe(400);
  });

  it("rejects a request without a body", async () => {
    const request = new Request(`${SYNTHETIC_ORIGIN}/api/v1/agents`, {
      headers: { "content-type": JSON_TYPE },
      method: "POST",
    });

    expect((await failure(readAgentJson(request))).code).toBe(
      "INVALID_REQUEST",
    );
  });

  it.each(["{", "", "[]", "null", "7", '"text"', "{} trailing"])(
    "rejects the body %j",
    async (body) => {
      const error = await failure(readAgentJson(agentRequest(body)));

      expect(error.code).toBe("INVALID_REQUEST");
    },
  );

  it("rejects bytes that are not valid UTF-8", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);

    const error = await failure(readAgentJson(agentRequest(bytes)));

    expect(error.code).toBe("INVALID_REQUEST");
  });
});

describe("readAgentJson size limits", () => {
  it("accepts an ordinary request of exactly 64 KiB", async () => {
    const body = envelopeOfSize(PAGES_AGENT_LIMITS.requestBytes, {
      operation: "projects.list",
    });

    const input = await readAgentJson(agentRequest(body));

    expect(input.operation).toBe("projects.list");
  });

  it("rejects an ordinary request above 64 KiB", async () => {
    const body = envelopeOfSize(PAGES_AGENT_LIMITS.requestBytes + 1, {
      operation: "projects.list",
    });

    const error = await failure(readAgentJson(agentRequest(body)));

    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(error.status).toBe(413);
    expect(error.details).toEqual({
      constraint: "requestBytes",
      limit: PAGES_AGENT_LIMITS.requestBytes,
    });
  });

  it.each(["wiki.page.create", "wiki.page.setContent"])(
    "lets %s carry wiki text beyond 64 KiB",
    async (operation) => {
      const body = envelopeOfSize(PAGES_AGENT_LIMITS.requestBytes * 4, {
        operation,
      });

      const input = await readAgentJson(agentRequest(body));

      expect(input.operation).toBe(operation);
    },
  );

  it.each([
    "plans.create",
    "plans.update",
    "plans.parameter.create",
    "plans.parameter.update",
  ])(
    "lets %s carry a complete plan field larger than 64 KiB",
    async (operation) => {
      const body = envelopeOfSize(PAGES_AGENT_LIMITS.requestBytes * 2, {
        operation,
      });
      const input = await readAgentJson(agentRequest(body));
      expect(input.operation).toBe(operation);
    },
  );

  it("keeps a finite two-MiB limit for plan edit envelopes", async () => {
    const limit = 2 * 1_048_576;
    const body = envelopeOfSize(limit + 1, { operation: "plans.update" });
    const error = await failure(readAgentJson(agentRequest(body)));
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(error.details).toEqual({ constraint: "requestBytes", limit });
  });

  it("keeps the ordinary 64 KiB limit for plan execution commands", async () => {
    const body = envelopeOfSize(PAGES_AGENT_LIMITS.requestBytes + 1, {
      operation: "plans.play",
    });
    const error = await failure(readAgentJson(agentRequest(body)));
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(error.details).toEqual({
      constraint: "requestBytes",
      limit: PAGES_AGENT_LIMITS.requestBytes,
    });
  });

  it("rejects an envelope above the wiki budget by its declared length", async () => {
    const request = agentRequest("{}", {
      "content-length": String(PAGES_AGENT_LIMITS.wikiEnvelopeBytes + 1),
      "content-type": JSON_TYPE,
    });

    const error = await failure(readAgentJson(request));

    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(error.details).toEqual({
      constraint: "requestBytes",
      limit: PAGES_AGENT_LIMITS.wikiEnvelopeBytes,
    });
  });

  it("stops an undeclared stream that exceeds the wiki budget", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(chunk);
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      body: stream,
      duplex: "half",
      headers: { "content-type": JSON_TYPE },
      method: "POST",
    };
    const request = new Request(`${SYNTHETIC_ORIGIN}/api/v1/agents`, init);

    const error = await failure(readAgentJson(request));

    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(produced).toBeLessThan(12);
  });
});
