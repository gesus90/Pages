import { describe, expect, it, vi } from "vitest";

import { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";

import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterCommand } from "@/definition/RunnerOpenRouter";

vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: vi.fn(),
}));

function fixture(): {
  service: RunnerOpenRouterService;
  send: Mock<(command: RunnerOpenRouterCommand) => void>;
  ready: ReturnType<typeof vi.fn>;
} {
  const ready = vi.fn().mockResolvedValue(undefined);
  const runners = partial<RunnerService>({
    ready,
    requireOnline: vi.fn().mockResolvedValue(undefined),
  });
  const service = new RunnerOpenRouterService(runners);
  const send = vi.fn<(command: RunnerOpenRouterCommand) => void>();
  service.attach("c", send);
  return { service, send, ready };
}

function reply(requestId: string): unknown {
  return {
    version: 1,
    type: "openrouter-result",
    requestId,
    result: {
      operation: "catalog",
      ok: true,
      freeModels: [],
      syncedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("runner provider channel", () => {
  it("shares concurrent catalog reads after checking both callers", async () => {
    const { service, send, ready } = fixture();
    const first = service.catalog("u1", "c");
    const second = service.catalog("u2", "c");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const command = send.mock.calls[0]?.[0];
    if (!command) throw new Error("Missing command");
    service.receive("c", reply(command.requestId));
    await expect(first).resolves.toMatchObject({
      operation: "catalog",
      ok: true,
    });
    await expect(second).resolves.toMatchObject({
      operation: "catalog",
      ok: true,
    });
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it("rejects unavailable channels and fails pending work when replaced", async () => {
    const { service, send } = fixture();
    await expect(
      service.execute("u", "missing", { operation: "catalog" }),
    ).rejects.toThrow("unavailable");
    const pending = service.execute("u", "c", { operation: "catalog" });
    const rejection = expect(pending).rejects.toThrow("replaced");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    service.attach("c", vi.fn());
    await rejection;
  });

  it("ignores unrelated replies and rejects mismatched operations", async () => {
    const { service, send } = fixture();
    const pending = service.execute("u", "c", { operation: "catalog" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const command = send.mock.calls[0]?.[0];
    if (!command) throw new Error("Missing command");
    service.receive("c", reply("00000000-0000-4000-8000-000000000000"));
    expect(() =>
      service.receive("c", {
        version: 1,
        type: "openrouter-result",
        requestId: command.requestId,
        result: {
          operation: "check",
          ok: true,
          keyStatus: 200,
          chatStatus: 200,
          model: "m",
          hasReply: true,
          isOkReply: true,
        },
      }),
    ).toThrow("mismatch");
    service.receive("c", reply(command.requestId));
    await expect(pending).resolves.toMatchObject({ operation: "catalog" });
  });
});
