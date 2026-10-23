import { randomUUID } from "node:crypto";

import {
  runnerGitHubAccessCommandSchema,
  runnerGitHubAccessReplySchema,
} from "@/definition/RunnerGitHubAccess";

import type {
  RunnerGitHubAccessCommand,
  RunnerGitHubAccessReply,
} from "@/definition/RunnerGitHubAccess";
import type { RunnerService } from "./RunnerService";

interface AccessChannel {
  readonly send: (command: RunnerGitHubAccessCommand) => void;
  pending: {
    readonly requestId: string;
    readonly repository: string;
    readonly resolve: (reply: RunnerGitHubAccessReply) => void;
    readonly reject: (error: Error) => void;
  } | null;
}

/** Runs transient Git probes on the authenticated runner without storing key material. */
export class RunnerGitHubAccessService {
  private readonly runners: RunnerService;
  private readonly channels = new Map<string, AccessChannel>();

  public constructor(runners: RunnerService) {
    this.runners = runners;
  }

  /** Replacement and disconnect reject pending probes; stale sockets cannot answer new requests. */
  public attach(connectionId: string, send: AccessChannel["send"]): () => void {
    this.channels
      .get(connectionId)
      ?.pending?.reject(new Error("Runner channel replaced"));
    const channel: AccessChannel = { send, pending: null };
    this.channels.set(connectionId, channel);
    return () => {
      channel.pending?.reject(new Error("Runner channel closed"));
      if (this.channels.get(connectionId) === channel)
        this.channels.delete(connectionId);
    };
  }

  /** Accepts only allowlisted diagnostics for the pending repository and request. */
  public receive(connectionId: string, input: unknown): void {
    const reply = runnerGitHubAccessReplySchema.parse(input);
    const pending = this.channels.get(connectionId)?.pending;
    if (pending?.requestId !== reply.requestId) return;
    if (pending.repository !== reply.repository)
      throw new Error("Runner repository mismatch");
    pending.resolve(reply);
  }

  /** Requires current administrator rights and a live runner; never falls back to HTTP or SSH. */
  public async execute(
    userId: string,
    connectionId: string,
    repository: string,
  ): Promise<RunnerGitHubAccessReply> {
    const command = runnerGitHubAccessCommandSchema.parse({
      version: 1,
      type: "github-access",
      requestId: randomUUID(),
      repository,
    });
    await this.runners.requireOnline(userId, connectionId);
    const channel = this.channels.get(connectionId);
    if (
      !this.runners.supportsGitHubAccess(connectionId) ||
      !channel ||
      channel.pending
    )
      throw new Error("Runner GitHub channel unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<RunnerGitHubAccessReply>((resolve, reject) => {
        channel.pending = {
          requestId: command.requestId,
          repository,
          resolve,
          reject,
        };
        timer = setTimeout(
          () => reject(new Error("Runner GitHub request timed out")),
          75_000,
        );
        channel.send(command);
      });
    } finally {
      clearTimeout(timer);
      channel.pending = null;
    }
  }
}
