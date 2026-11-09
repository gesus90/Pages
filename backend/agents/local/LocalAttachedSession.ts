import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { readAcpSteerOutcome } from "@/backend/agents/acp/AcpChat";

import {
  localClosedSchema,
  localJournalRecordSchema,
} from "./LocalSessionContracts";
import { localDeferred } from "./LocalDeferred";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
  PlanSessionClosed,
} from "@/backend/agents/AgentPlanExecution";
import type { LocalSessionImport } from "./LocalSessionImport";
import type {
  LocalSessionCommand,
  LocalSessionLaunch,
  LocalSessionMutation,
} from "./LocalSessionContracts";

interface AttachedDependencies {
  readonly importer: LocalSessionImport;
  readonly control: (command: LocalSessionCommand) => Promise<unknown>;
  readonly completion: (turnId: string) => Promise<LocalSessionMutation | null>;
  readonly nextLaunch: (input: AgentPlanExecutionInput) => LocalSessionLaunch;
  readonly namespace: (
    mutation: Extract<LocalSessionMutation, { kind: "started" }>,
  ) => Promise<void>;
}

function isRecorderMutation(
  mutation: LocalSessionMutation,
): mutation is Extract<
  LocalSessionMutation,
  { kind: "usage" | "events" | "position" | "frame" | "attempt" }
> {
  return ["usage", "events", "position", "frame", "attempt"].includes(
    mutation.kind,
  );
}

/** A replaceable Pages observer of a persistent native protocol owner. */
export class LocalAttachedSession implements PlanSession {
  public readonly isDurable = true;
  public readonly terminated: Promise<void>;
  private readonly dependencies: AttachedDependencies;
  private observer: PlanSessionObserver;
  private launch: LocalSessionLaunch;
  private pending: Promise<PlanSessionTurn>;
  private resolveTurn: (turn: PlanSessionTurn) => void;
  private rejectTurn: (error: unknown) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed: PlanSessionClosed | null = null;
  private closing: Promise<PlanSessionClosed> | null = null;
  private signal: AbortSignal;
  private detached = false;
  private reading: Promise<number> | null = null;
  private readonly ended = localDeferred<void>();
  private hasImportedClose = false;
  private hasCompletedClose = false;
  private readFailure: unknown = null;

  public constructor(
    launch: LocalSessionLaunch,
    signal: AbortSignal,
    observer: PlanSessionObserver,
    dependencies: AttachedDependencies,
  ) {
    this.launch = launch;
    this.signal = signal;
    this.observer = observer;
    this.dependencies = dependencies;
    this.terminated = this.ended.promise;
    const turn = localDeferred<PlanSessionTurn>();
    this.pending = turn.promise;
    this.resolveTurn = turn.resolve;
    this.rejectTurn = turn.reject;
    signal.addEventListener("abort", this.abort, { once: true });
    // A constructor may precede the caller's await of turn.
    void this.pending.catch((error: unknown) =>
      logCaughtError("LocalAttachedSession", error),
    );
  }

  /** The current genuine native turn, restored from durable result custody when already complete. */
  public get turn(): Promise<PlanSessionTurn> {
    return this.pending;
  }

  /** Whether the web process has stopped observing this session. */
  public get isDetached(): boolean {
    return this.detached;
  }

  /** Whether native closeout has begun. */
  public get isClosing(): boolean {
    return this.closing !== null || this.closed !== null;
  }

  /** Whether confirmed native closeout and its complete history drain finished before detachment. */
  public get isClosed(): boolean {
    return this.hasCompletedClose;
  }

  /** Restores milestones, then reads strictly after the committed database cursor. */
  public async attach(): Promise<void> {
    for (const mutation of await this.dependencies.importer.restore())
      await this.deliver(mutation);
    const completed = await this.dependencies.completion(this.launch.turnId);
    if (completed) await this.deliver(completed);
    await this.acknowledge();
    await this.poll();
    if (this.signal.aborted) this.abort();
  }

  /** Rebinds the current observer without sending a native initialize/new/prompt request. */
  public async observe(
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<void> {
    this.signal.removeEventListener("abort", this.abort);
    this.signal = signal;
    this.observer = observer;
    signal.addEventListener("abort", this.abort, { once: true });
    for (const mutation of await this.dependencies.importer.restore())
      await this.deliver(mutation);
    if (signal.aborted) this.abort();
  }

  /** Detaches all transient callbacks without closing the protocol, pipes, unit or native turn. */
  public detach(): void {
    this.detached = true;
    if (this.timer) clearTimeout(this.timer);
    this.signal.removeEventListener("abort", this.abort);
  }

  /** Sends only a new, explicitly authorized turn; reattachment never enters this method. */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    if (this.isClosing || this.detached)
      throw new AgentError("plan_session_unavailable");
    this.signal.removeEventListener("abort", this.abort);
    this.signal = signal;
    this.signal.addEventListener("abort", this.abort, { once: true });
    this.observer = observer;
    this.launch = this.dependencies.nextLaunch(input);
    const next = localDeferred<PlanSessionTurn>();
    this.pending = next.promise;
    this.resolveTurn = next.resolve;
    this.rejectTurn = next.reject;
    await this.dependencies.control({ kind: "next", launch: this.launch });
    if (signal.aborted) await this.cancel();
    return this.pending;
  }

  /** Keeps steering inside the authenticated native owner's durable command boundary. */
  public async steer(
    prompt: readonly ContentBlock[],
  ): Promise<AcpSteerOutcome> {
    if (prompt.some((block) => block.type !== "text")) return "failed";
    const text = prompt
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    return readAcpSteerOutcome(
      await this.dependencies.control({
        kind: "steer",
        prompt: text,
        commandId: randomUUID(),
      }),
    );
  }

  /** Interrupts the running prompt inside the authenticated native owner (PAGE-284). */
  public async interrupt(): Promise<boolean> {
    const answer = await this.dependencies.control({ kind: "interrupt" });
    return (
      typeof answer === "object" &&
      answer !== null &&
      Reflect.get(answer, "interrupted") === true
    );
  }

  /** Requires owner proof again and returns the actual native cleanup result. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.closeOnce().catch((error: unknown) => {
      this.closing = null;
      throw error;
    });
    return this.closing;
  }

  private readonly abort = (): void => {
    void this.cancel().catch((error: unknown) => this.fail(error));
  };

  private async closeOnce(): Promise<PlanSessionClosed> {
    if (!this.closed) {
      const response = z
        .object({ closed: localClosedSchema })
        .parse(await this.dependencies.control({ kind: "close" }));
      this.closed = response.closed;
    }
    await this.drain();
    if (!this.hasImportedClose)
      throw new Error("Native closeout history is not durably imported");
    this.hasCompletedClose = this.closed.isConfirmed && !this.detached;
    this.detach();
    return this.closed;
  }

  private async cancel(): Promise<void> {
    if (this.detached) return;
    await this.dependencies.control({ kind: "cancel" });
    await this.drain();
  }

  private async poll(): Promise<number> {
    if (this.detached) return 0;
    if (this.reading) return this.reading;
    if (this.timer) clearTimeout(this.timer);
    this.reading = this.readOnce();
    try {
      return await this.reading;
    } finally {
      this.reading = null;
      if (!this.detached)
        this.timer = setTimeout(() => {
          void this.poll();
        }, 250);
    }
  }

  private async drain(): Promise<void> {
    if (this.reading) await this.reading;
    while (await this.poll()) {
      if (this.detached) return;
    }
    if (this.readFailure !== null) throw this.readFailure;
  }

  private async readOnce(): Promise<number> {
    try {
      const response = z
        .object({ records: z.array(localJournalRecordSchema).max(200) })
        .parse(
          await this.dependencies.control({
            kind: "read",
            after: this.dependencies.importer.cursor,
            limit: 100,
          }),
        );
      for (const record of response.records) {
        if (this.detached) return 0;
        const mutation = await this.dependencies.importer.take(record);
        if (this.detached) return 0;
        await this.deliver(mutation);
        await this.dependencies.control({
          kind: "ack",
          sequence: record.sequence,
          digest: record.digest,
        });
      }
      this.readFailure = null;
      return response.records.length;
    } catch (error: unknown) {
      if (this.detached) return 0;
      this.readFailure = error;
      if (
        error instanceof AgentError &&
        error.code === "plan_local_owner_unverified"
      )
        this.fail(error);
      else {
        logCaughtError("LocalAttachedSession", error);
        await this.refresh().catch((refreshError: unknown) =>
          logCaughtError("LocalAttachedSession", refreshError),
        );
      }
      return 0;
    }
  }

  private async refresh(): Promise<void> {
    const checkpoint = await this.dependencies.importer.refresh();
    if (this.detached) return;
    for (const mutation of checkpoint) await this.deliver(mutation);
    const completion = await this.dependencies.completion(this.launch.turnId);
    if (completion) await this.deliver(completion);
    await this.acknowledge();
  }

  private async acknowledge(): Promise<void> {
    if (this.detached) return;
    const acknowledged = this.dependencies.importer.acknowledgement;
    if (acknowledged.sequence > 0)
      await this.dependencies.control({ kind: "ack", ...acknowledged });
  }

  private async deliver(mutation: LocalSessionMutation): Promise<void> {
    if (this.detached || isRecorderMutation(mutation)) return;
    // Recorder mutations are already imported; only milestones notify the observer.
    switch (mutation.kind) {
      case "started":
        await this.dependencies.namespace(mutation);
        if (this.detached) return;
        this.observer.started(mutation.details);
        break;
      case "identified":
        this.observer.identified(mutation.sessionId);
        break;
      case "capabilities":
        this.observer.capabilities?.(mutation.capabilities);
        break;
      case "progressed":
        this.observer.progressed?.(mutation.events);
        break;
      case "activity":
        this.observer.activity?.(mutation.activity);
        break;
      case "turn":
        if (mutation.turnId === this.launch.turnId)
          this.resolveTurn(mutation.result);
        break;
      case "closed":
        this.closed = mutation.result;
        this.hasImportedClose = true;
        this.ended.resolve();
        break;
    }
  }

  private fail(error: unknown): void {
    logCaughtError("LocalAttachedSession", error);
    this.detach();
    this.rejectTurn(new AgentError("plan_local_owner_unverified"));
  }
}
