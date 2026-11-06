import { setTimeout } from "node:timers/promises";

import { restoreGitHubJobError } from "./GitHubJobErrors";

import type { GitHubJobRepository } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import type {
  GitHubCommand,
  GitHubJobResult,
} from "@/definition/IntegrationJobs";
import type { GitHubSyncSummary } from "@/definition/GitHub";
import type { ScheduledSyncResult } from "@/backend/service/github/GitHubSyncRunner";

/** Durable producer and bounded result wait for the existing synchronous APIs. */
export class GitHubJobClient {
  private readonly jobs: GitHubJobRepository;
  private readonly shouldWaitForPublication: boolean;

  /** No consumer is started here; enqueue works while the service is stopped. */
  public constructor(
    jobs: GitHubJobRepository,
    options: { readonly waitForPublication?: boolean } = {},
  ) {
    this.jobs = jobs;
    this.shouldWaitForPublication = options.waitForPublication ?? false;
  }

  /** Waits for the existing sync summary, preserving its public shape. */
  public async summary(command: GitHubCommand): Promise<GitHubSyncSummary> {
    const reply = await this.request(command);
    if (reply.kind !== "summary")
      throw new Error("Invalid GitHub summary reply.");
    return reply.summary;
  }

  /** Returns a local task identifier; the API rereads it under current access rules. */
  public async task(command: GitHubCommand): Promise<string> {
    const reply = await this.request(command);
    if (reply.kind !== "task") throw new Error("Invalid GitHub task reply.");
    return reply.id;
  }

  /** Returns the connection probe result without sharing credentials across processes. */
  public async test(command: GitHubCommand): Promise<boolean> {
    const reply = await this.request(command);
    if (reply.kind !== "boolean")
      throw new Error("Invalid GitHub connection reply.");
    return reply.result;
  }

  /** Records an already committed ticket change before returning to its producer. */
  public async publish(
    command: Extract<GitHubCommand, { operation: "publish" }>,
  ): Promise<void> {
    // Do not merge into running work: a newer change must have its own later reconciliation.
    if (this.shouldWaitForPublication) {
      await this.request(command);
      return;
    }
    await this.jobs.enqueue(command);
  }

  /** Queues the existing scheduled batch and returns its actual counters. */
  public async scheduled(): Promise<ScheduledSyncResult> {
    const reply = await this.request({ operation: "scheduled" }, "scheduled");
    if (reply.kind !== "scheduled")
      throw new Error("Invalid scheduled GitHub reply.");
    return { completed: reply.completed, failed: reply.failed };
  }

  private async request(
    command: GitHubCommand,
    key: string | null = null,
  ): Promise<GitHubJobResult> {
    const id = await this.jobs.enqueue(command, key);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const reply = await this.jobs.result(id);
      if (reply?.kind === "error") throw restoreGitHubJobError(reply.code);
      if (reply) return reply;
      await setTimeout(100);
    }
    throw new Error(
      "GitHub processing is pending; the durable job will continue when the integration processor is available.",
    );
  }
}
