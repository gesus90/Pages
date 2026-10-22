import { randomUUID } from "node:crypto";

import { registerLogSecret } from "@/backend/logging/LogRedaction";
import {
  runnerOpenRouterCommandSchema,
  runnerOpenRouterReplySchema,
} from "@/definition/RunnerOpenRouter";

import type {
  RunnerOpenRouterCommand,
  RunnerOpenRouterResult,
} from "@/definition/RunnerOpenRouter";
import type { RunnerService } from "./RunnerService";

interface PendingCommand {
  readonly requestId: string;
  readonly operation: RunnerOpenRouterCommand["operation"];
  readonly resolve: (result: RunnerOpenRouterResult) => void;
  readonly reject: (error: Error) => void;
}

interface ProviderChannel {
  readonly send: (command: RunnerOpenRouterCommand) => void;
  pending: PendingCommand | null;
}

/** Relays provider configuration without storing credentials in Pages or its job journal. */
export class RunnerOpenRouterService {
  private readonly runners: RunnerService;
  private readonly catalogReads = new Map<
    string,
    Promise<RunnerOpenRouterResult>
  >();
  private readonly channels = new Map<string, ProviderChannel>();

  public constructor(runners: RunnerService) {
    this.runners = runners;
  }

  /** Binds only a reconciled channel; replacement rejects any previous pending request. */
  public attach(
    connectionId: string,
    send: ProviderChannel["send"],
  ): () => void {
    this.channels
      .get(connectionId)
      ?.pending?.reject(new Error("Runner channel replaced"));
    const channel: ProviderChannel = { send, pending: null };
    this.channels.set(connectionId, channel);
    return () => {
      channel.pending?.reject(new Error("Runner channel closed"));
      if (this.channels.get(connectionId) === channel)
        this.channels.delete(connectionId);
    };
  }

  /** Accepts only the expected reply on the already authenticated runner channel. */
  public receive(connectionId: string, input: unknown): void {
    const reply = runnerOpenRouterReplySchema.parse(input);
    const pending = this.channels.get(connectionId)?.pending;
    if (pending?.requestId !== reply.requestId) return;
    if (
      reply.result.operation !== "failed" &&
      reply.result.operation !== pending.operation
    )
      throw new Error("Runner provider operation mismatch");
    pending.resolve(reply.result);
  }

  /** Shares concurrent catalog reads after checking each caller's current runner rights. */
  public async catalog(
    userId: string,
    connectionId: string,
  ): Promise<RunnerOpenRouterResult> {
    await this.runners.ready(userId, connectionId);
    const previous = this.catalogReads.get(connectionId);
    if (previous) return previous;
    const current = this.execute(userId, connectionId, {
      operation: "catalog",
    });
    this.catalogReads.set(connectionId, current);
    try {
      return await current;
    } finally {
      if (this.catalogReads.get(connectionId) === current)
        this.catalogReads.delete(connectionId);
    }
  }

  /** Rechecks administrator access and runner revision immediately before secret transfer. */
  public async execute(
    userId: string,
    connectionId: string,
    input: unknown,
  ): Promise<RunnerOpenRouterResult> {
    const command = runnerOpenRouterCommandSchema.parse({
      ...(typeof input === "object" && input !== null ? input : {}),
      version: 1,
      type: "openrouter",
      requestId: randomUUID(),
    });
    if (command.operation === "sync") registerLogSecret(command.apiKey);
    await this.runners.requireOnline(userId, connectionId);
    const channel = this.channels.get(connectionId);
    if (!channel || channel.pending)
      throw new Error("Runner provider channel unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<RunnerOpenRouterResult>((resolve, reject) => {
        channel.pending = {
          requestId: command.requestId,
          operation: command.operation,
          resolve,
          reject,
        };
        timer = setTimeout(
          () => reject(new Error("Runner provider request timed out")),
          90_000,
        );
        channel.send(command);
      });
    } finally {
      clearTimeout(timer);
      channel.pending = null;
    }
  }
}
