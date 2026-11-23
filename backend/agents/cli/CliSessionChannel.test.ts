import { expect, it, vi } from "vitest";

import { connectChild } from "./CliSessionChannel";

import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import type { CliSessionProcess } from "./CliSessionProcess";

const namespace = { pid: 1, uid: 2, start: 3, boot: "boot" };

function setup(): {
  child: CliSessionProcess;
  channel: AcpLineChannel;
  observer: PlanSessionObserver;
  attach: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  started: ReturnType<typeof vi.fn>;
  writeAsync: ReturnType<typeof vi.fn>;
  exit: () => void;
} {
  let exit: () => void = () => undefined;
  const writeAsync = vi.fn();
  const attach = vi.fn();
  const close = vi.fn();
  const started = vi.fn();
  const child = {
    processId: 42,
    writeAsync,
    exited: new Promise<void>((resolve) => {
      exit = resolve;
    }),
  } as unknown as CliSessionProcess;
  return {
    child,
    channel: { attach, close } as unknown as AcpLineChannel,
    observer: { started } as unknown as PlanSessionObserver,
    attach,
    close,
    started,
    writeAsync,
    exit: () => exit(),
  };
}

it("attaches the channel, reports the start and closes on exit", async () => {
  const fixture = setup();
  const controller = new AbortController();
  const removal = vi.spyOn(controller.signal, "removeEventListener");
  connectChild(fixture.child, fixture.channel, {
    observer: fixture.observer,
    arguments: ["--acp"],
    unattended: "yolo",
    signal: controller.signal,
    namespace,
  });

  fixture.attach.mock.calls[0]?.[0]("line");
  expect(fixture.writeAsync).toHaveBeenCalledWith("line");
  expect(fixture.started).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "interactive",
      processId: 42,
      arguments: ["--acp"],
      unattended: "yolo",
      namespace,
    }),
  );
  expect(fixture.close).not.toHaveBeenCalled();

  fixture.exit();
  await fixture.child.exited;
  await Promise.resolve();
  expect(removal).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

it("closes on abort and omits an absent namespace", () => {
  const fixture = setup();
  const controller = new AbortController();
  connectChild(fixture.child, fixture.channel, {
    observer: fixture.observer,
    arguments: [],
    unattended: "read_only",
    signal: controller.signal,
  });
  expect(fixture.started.mock.calls[0]?.[0]).not.toHaveProperty("namespace");
  controller.abort();
  expect(fixture.close).toHaveBeenCalledTimes(1);
});

it("closes immediately when the signal is already aborted", () => {
  const fixture = setup();
  const controller = new AbortController();
  controller.abort();
  connectChild(fixture.child, fixture.channel, {
    observer: fixture.observer,
    arguments: [],
    unattended: "read_only",
    signal: controller.signal,
  });
  expect(fixture.close).toHaveBeenCalledTimes(1);
});
