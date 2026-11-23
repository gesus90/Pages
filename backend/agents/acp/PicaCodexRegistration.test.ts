import { describe, expect, it, vi } from "vitest";

import {
  createPicaCodexRequests,
  registerPicaCodexRequests,
} from "@/backend/agents/acp/PicaCodexRegistration";
import { PICA_CODEX_METHOD } from "@/backend/agents/acp/PicaCodexProtocol";
import { PicaCodexRequests } from "@/backend/agents/acp/PicaCodexRequests";

import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";

const listener = { catalog: vi.fn(), capture: vi.fn() };

function contextFor(
  provider: string,
  withListener: boolean,
): Pick<AcpSessionContext, "driver" | "listener"> {
  return {
    driver: { provider },
    listener: withListener ? { picaCodex: listener } : {},
  } as unknown as Pick<AcpSessionContext, "driver" | "listener">;
}

describe("createPicaCodexRequests", () => {
  it("creates requests for codex and opencode with a listener", () => {
    expect(
      createPicaCodexRequests(
        contextFor("codex_cli", true),
        () => null,
        () => false,
      ),
    ).toBeInstanceOf(PicaCodexRequests);
    expect(
      createPicaCodexRequests(
        contextFor("opencode", true),
        () => null,
        () => false,
      ),
    ).toBeInstanceOf(PicaCodexRequests);
  });

  it("returns null without a listener or for other providers", () => {
    expect(
      createPicaCodexRequests(
        contextFor("codex_cli", false),
        () => null,
        () => false,
      ),
    ).toBeNull();
    expect(
      createPicaCodexRequests(
        contextFor("claude", true),
        () => null,
        () => false,
      ),
    ).toBeNull();
  });
});

describe("registerPicaCodexRequests", () => {
  type Handler = (input: {
    params: Record<string, unknown>;
    signal?: AbortSignal;
  }) => unknown;

  function register(native: Record<string, unknown>): Map<string, Handler> {
    const handlers = new Map<string, Handler>();
    const schemas: unknown[] = [];
    const client = {
      onRequest(name: string, schema: unknown, handler: Handler): unknown {
        schemas.push(schema);
        handlers.set(name, handler);
        return client;
      },
    };
    registerPicaCodexRequests(
      client as never,
      native as unknown as PicaCodexRequests,
    );
    return handlers;
  }

  it("routes every private method to the native requests", async () => {
    const signal = new AbortController().signal;
    const native = {
      catalog: vi.fn().mockResolvedValue(["tool"]),
      catalogContext: vi.fn().mockReturnValue("ctx"),
      bindThread: vi.fn().mockReturnValue(true),
      prepareTurn: vi.fn().mockReturnValue({ nonce: "n" }),
      admitReady: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      revokeOperation: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      cancelPrepare: vi.fn().mockResolvedValue(true),
      bindTurn: vi.fn().mockReturnValue(true),
      endTurn: vi.fn().mockResolvedValue(undefined),
      closeThread: vi.fn().mockResolvedValue(undefined),
      dispatch: vi.fn().mockReturnValue("dispatched"),
      chunk: vi.fn().mockReturnValue("chunked"),
    };
    const handlers = register(native);
    const call = (
      name: string,
      params: Record<string, unknown> = {},
    ): unknown => handlers.get(name)?.({ params, signal });

    await expect(call(PICA_CODEX_METHOD.catalog)).resolves.toEqual({
      tools: ["tool"],
      context: "ctx",
    });
    expect(
      call(PICA_CODEX_METHOD.bindThread, { threadId: "t", context: "c" }),
    ).toEqual({ accepted: true });
    expect(call(PICA_CODEX_METHOD.prepare, { threadId: "t" })).toEqual({
      nonce: "n",
    });
    expect(call(PICA_CODEX_METHOD.ready, { a: 1 })).toEqual({
      a: 1,
      accepted: true,
    });
    expect(call(PICA_CODEX_METHOD.ready, { a: 1 })).toEqual({
      accepted: false,
    });
    await expect(call(PICA_CODEX_METHOD.revoke, { a: 1 })).resolves.toEqual({
      a: 1,
      accepted: true,
    });
    await expect(call(PICA_CODEX_METHOD.revoke, { a: 1 })).resolves.toEqual({
      accepted: false,
    });
    await expect(
      call(PICA_CODEX_METHOD.cancelPrepare, { threadId: "t", nonce: "n" }),
    ).resolves.toEqual({ cancelled: true });
    expect(
      call(PICA_CODEX_METHOD.bindTurn, { threadId: "t", turnId: "u" }),
    ).toEqual({ accepted: true });
    await expect(
      call(PICA_CODEX_METHOD.endTurn, { threadId: "t", turnId: "u" }),
    ).resolves.toEqual({ ended: true });
    await expect(
      call(PICA_CODEX_METHOD.closeThread, { threadId: "t" }),
    ).resolves.toEqual({ closed: true });
    expect(call(PICA_CODEX_METHOD.dispatch, { callId: "c" })).toBe(
      "dispatched",
    );
    expect(native.dispatch).toHaveBeenCalledWith({ callId: "c" }, signal);
    expect(call(PICA_CODEX_METHOD.chunk, { offset: 0 })).toBe("chunked");
  });
});
