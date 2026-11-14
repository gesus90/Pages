import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import { settleWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";
import { AgentError } from "@/backend/error/AgentErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { localClosedSchema } from "./LocalSessionContracts";
import { LocalSessionJournal } from "./LocalSessionJournal";
import { LocalSessionImport } from "./LocalSessionImport";
import { LocalAttachedSession } from "./LocalAttachedSession";
import {
  createLocalSessionLaunch,
  localSessionDirectory,
  readCurrentLocalLaunch,
  readLocalSessionMilestones,
  readSharedLocalLaunch,
} from "./LocalSessionLaunch";
import {
  hasEndedLocalOwner,
  localManifestDigest,
  proveLocalOwner,
} from "./LocalSessionOwnership";
import { requireLocalDirectory, writeLocalRecord } from "./LocalSessionFiles";
import { sendLocalCommand } from "./LocalSessionTransport";
import { startLocalSessionUnit } from "./LocalSessionUnit";
import {
  registerLocalOwnerInspection,
  registerLocalOwnerSettlement,
} from "./LocalOwnerControl";
import { forgetForcedLocalRun } from "./LocalSessionForcedRelease";
import { waitForLocalOwnerReady } from "./LocalOwnerReady";
import { pinLocalSessionTools } from "./LocalSessionTools";
import { LocalFinishedSessions } from "./LocalFinishedSessions";
import { readLocalCompletion } from "./LocalSessionCompletion";
import { localInstanceKey } from "./LocalSessionIdentity";

import type { Database } from "@/backend/database/Database";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AcpStartLifecycle } from "@/backend/service/agents/resources/AcpStartLifecycle";
import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  LocalOwnerManifest,
  LocalSessionLaunch,
  LocalSessionCommand,
  LocalSessionMutation,
} from "./LocalSessionContracts";

interface LocalSessionsInput {
  readonly database: Database;
  readonly configPath: string;
  readonly dataDirectory: string;
  readonly tokenKey: Buffer;
  readonly resources: AcpResourceScheduler;
  readonly tools: AgentToolManagerService;
}

interface AttachedOwner {
  readonly raw: LocalAttachedSession;
  readonly session: PlanSession;
}

/** Instance-bound native session launch, discovery, proof and replaceable observers. */
export class LocalSessions {
  private readonly input: LocalSessionsInput;
  private readonly owners: LocalSessionRepository;
  private readonly runs: AgentPlanRunRepository;
  private readonly instanceKey: string;
  private readonly entries = new Map<string, LocalSessionEntry>();
  private readonly attached = new Map<string, AttachedOwner>();
  private readonly proven = new Set<string>();
  private readonly uncertain = new Set<string>();
  private readonly launching = new Set<string>();
  private readonly attachments = new Map<string, string>();
  private isDetaching = false;
  private readonly finished = new LocalFinishedSessions((entry) =>
    this.settleFinishedEntry(entry),
  );

  public constructor(input: LocalSessionsInput) {
    this.input = input;
    this.owners = new LocalSessionRepository(input.database);
    this.runs = new AgentPlanRunRepository(input.database);
    this.instanceKey = localInstanceKey(input.tokenKey, input.configPath);
    registerLocalOwnerSettlement((instanceId) =>
      this.settleManaged(instanceId),
    );
    registerLocalOwnerInspection((instanceId) => {
      const entry = this.entries.get(instanceId);
      if (!entry) return null;
      return entry.releasedAt ? "released" : "owned";
    });
  }

  /** Proves surviving units before any credential, lease or plan cleanup is permitted. */
  public async discover(): Promise<{
    readonly adopted: ReadonlySet<string>;
    readonly uncertain: ReadonlySet<string>;
  }> {
    for (const entry of await this.owners.list(this.instanceKey)) {
      this.entries.set(entry.instanceId, entry);
      if (entry.releasedAt) continue;
      const run = await this.runs.find(entry.runId);
      try {
        const owned = await proveLocalOwner(
          entry,
          this.directory(entry.instanceId),
        );
        await waitForLocalOwnerReady(this.directory(entry.instanceId));
        await this.owners.prove(entry.instanceId, owned.proof);
        this.entries.set(entry.instanceId, { ...entry, proof: owned.proof });
        this.proven.add(entry.instanceId);
        const record =
          run &&
          allPlanRunResults(run).find(
            (step) => step.session?.instanceId === entry.instanceId,
          )?.session;
        if (record && record.runner !== "api")
          pinLocalSessionTools(this.input.tools, {
            instanceId: entry.instanceId,
            provider: record.runner,
            browser: record.requested.options?.browser === true,
          });
      } catch (error: unknown) {
        this.proven.delete(entry.instanceId);
        this.uncertain.add(entry.instanceId);
        logCaughtError("LocalSessions", error);
        logEvent({
          level: "warn",
          event: "agent.local_owner.unverified",
          component: "LocalSessions",
          message:
            "Local native owner was not adopted or signalled; its reservations remain uncertain",
          metadata: { instanceId: entry.instanceId, runId: entry.runId },
        });
      }
    }
    return { adopted: this.proven, uncertain: this.uncertain };
  }

  /** Imports and releases completed runs with one bounded startup wait; slow cleanup continues independently. */
  public async settleFinished(): Promise<void> {
    await this.finished.start(
      [...this.entries.values()].filter((entry) =>
        this.proven.has(entry.instanceId),
      ),
    );
  }

  /** Whether an unfinished run has independently proven local work to restore. */
  public hasRun(runId: string): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        entry.runId === runId &&
        (this.proven.has(entry.instanceId) ||
          this.launching.has(entry.instanceId)),
    );
  }

  /** Controls only independently proven owners of this instance and run. */
  public async setRunPaused(runId: string, isPaused: boolean): Promise<void> {
    const entries = [...this.entries.values()].filter(
      (entry) => entry.runId === runId && !entry.releasedAt,
    );
    await Promise.all(
      entries.map(async (entry) => {
        if (this.launching.has(entry.instanceId)) return;
        if (!this.proven.has(entry.instanceId))
          throw new AgentError("plan_local_owner_unverified");
        await this.control(entry, { kind: "pause", isPaused });
      }),
    );
  }

  /** Whether this exact native instance may be reattached. */
  public has(instanceId: string): boolean {
    return this.proven.has(instanceId);
  }

  /** Exposes uncertain native identities only to recovery, never as live ownership. */
  public unverified(): ReadonlySet<string> {
    return this.uncertain;
  }

  /** Starts one real independently owned native session after the existing capacity admission. */
  public async open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    if (this.isDetaching) throw new AgentError("plan_run_unavailable");
    const launch = createLocalSessionLaunch(
      input,
      input.instanceId,
      input.mcp ?? null,
      input.options.timeoutMinutes,
    );
    const recording = input.recording;
    if (!recording) throw new AgentError("plan_context_changed");
    if (this.entries.has(input.instanceId))
      throw new AgentError("plan_local_owner_unverified");
    await input.beforeStart?.();
    return this.input.resources
      .open(
        {
          instanceId: input.instanceId,
          runId: launch.runId,
          stepId: launch.stepId,
          userId: launch.userId,
          provider: recording.provider,
        },
        signal,
        (admitted, lifecycle) => {
          lifecycle.trackSpawn();
          return this.startOwner(
            input,
            launch,
            { signal: admitted, lifecycle },
            observer,
          );
        },
        observer,
      )
      .then((session) => {
        const attached = this.attached.get(input.instanceId);
        if (attached)
          this.attached.set(input.instanceId, { ...attached, session });
        return session;
      });
  }

  /** Reattaches a saved attempt, returning its saved native result when already complete. */
  public async reattach(
    record: AgentPlanSessionRecord,
    signal: AbortSignal,
    observer: PlanSessionObserver,
    options: { readonly current?: boolean } = {},
  ): Promise<PlanSession> {
    const entry = this.requireEntry(record.instanceId);
    await proveLocalOwner(entry, this.directory(entry.instanceId));
    let attached = this.attached.get(record.instanceId);
    if (!attached) {
      const launch = await readCurrentLocalLaunch(
        this.directory(entry.instanceId),
        entry,
      );
      const raw = await this.bind(entry, launch, signal, observer);
      const session = await this.input.resources.adoptSession(
        entry.instanceId,
        raw,
        observer,
      );
      attached = { raw, session };
      this.attached.set(entry.instanceId, attached);
    }
    await attached.raw.observe(signal, observer);
    const result =
      record.attemptId && !options.current
        ? await readLocalCompletion(
            this.owners,
            this.input.database,
            entry.instanceId,
            record.attemptId,
          )
        : null;
    const session = attached.session;
    return {
      turn:
        result?.kind === "turn" ? Promise.resolve(result.result) : session.turn,
      isDurable: true,
      terminated: session.terminated,
      get isDetached(): boolean {
        return session.isDetached === true;
      },
      get isClosing(): boolean {
        return session.isClosing === true;
      },
      detach: () => session.detach?.(),
      close: () => session.close(),
      next: (input, nextSignal, nextObserver) => {
        if (!session.next)
          throw new AgentError("plan_group_session_unsupported");
        return session.next(input, nextSignal, nextObserver);
      },
      steer: (prompt) => session.steer?.(prompt) ?? Promise.resolve("inactive"),
      interrupt: () => session.interrupt?.() ?? Promise.resolve(false),
    };
  }

  /** Provides the original shared MCP slot without issuing a replacement credential. */
  public async sharedInput(
    instanceId: string,
    turnId?: string,
  ): Promise<LocalSessionLaunch> {
    const entry = this.requireEntry(instanceId);
    return readSharedLocalLaunch(this.directory(instanceId), entry, turnId);
  }

  /** Reads the committed milestones used to restore retained native group bookkeeping. */
  public async milestones(
    instanceId: string,
  ): Promise<readonly LocalSessionMutation[]> {
    return readLocalSessionMilestones(
      this.owners,
      this.instanceKey,
      this.input.database,
      instanceId,
    );
  }

  /** Stops polling before resource shutdown aborts transient controllers; native work and leases remain. */
  public detachAll(): void {
    this.isDetaching = true;
    for (const owner of this.attached.values()) owner.session.detach?.();
  }

  /** Detaches only the observers of one owned run. */
  public detachRun(runId: string): boolean {
    if (!this.hasRun(runId)) return false;
    for (const entry of this.entries.values())
      if (entry.runId === runId)
        this.attached.get(entry.instanceId)?.session.detach?.();
    return true;
  }

  /** Retires observers after an explicit forced start; the durable journal records any cleanup uncertainty. */
  public async forgetForcedRun(runId: string): Promise<void> {
    await forgetForcedLocalRun(runId, {
      entries: this.entries,
      attached: this.attached,
      proven: this.proven,
      uncertain: this.uncertain,
      release: (entry) => this.release(entry),
    });
  }

  /** Releases proven owner processes only after native closeout and public history import. */
  public async finishRun(runId: string): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.runId !== runId || !this.proven.has(entry.instanceId)) continue;
      const attached = this.attached.get(entry.instanceId);
      // A successful close also detaches; only a shutdown detach keeps its owner.
      if (!attached) continue;
      if (attached.session.isDetached && !attached.raw.isClosed) continue;
      if (
        !(await attached.session.close()).isConfirmed ||
        !attached.raw.isClosed
      )
        continue;
      await this.release(entry);
    }
  }

  private async startOwner(
    input: AgentPlanSessionInput,
    launch: LocalSessionLaunch,
    admission: {
      readonly signal: AbortSignal;
      readonly lifecycle: AcpStartLifecycle;
    },
    observer: PlanSessionObserver,
  ): Promise<LocalAttachedSession> {
    if (!input.recording) throw new AgentError("plan_context_changed");
    const directory = this.directory(input.instanceId);
    await requireLocalDirectory(path.dirname(directory));
    await requireLocalDirectory(directory);
    const manifest: LocalOwnerManifest = {
      version: 1,
      instanceKey: this.instanceKey,
      capability: randomBytes(32).toString("hex"),
      configPath: this.input.configPath,
      directory,
      unit: `pages-local-${input.instanceId}.service`,
      launch,
    };
    await writeLocalRecord(path.join(directory, "manifest.json"), manifest);
    const entry: LocalSessionEntry = {
      instanceId: input.instanceId,
      instanceKey: this.instanceKey,
      runId: launch.runId,
      stepId: launch.stepId,
      attemptId: launch.attemptId,
      manifestDigest: localManifestDigest(manifest),
      proof: null,
      acknowledgedSequence: 0,
      acknowledgedDigest: "",
      checkpointFile: null,
      releasedAt: null,
    };
    await this.owners.create(entry);
    this.entries.set(entry.instanceId, entry);
    this.launching.add(entry.instanceId);
    pinLocalSessionTools(this.input.tools, {
      instanceId: entry.instanceId,
      provider: input.recording.provider,
      browser: input.options.browser === true,
    });
    try {
      await admission.lifecycle.beforeSpawn();
      await startLocalSessionUnit(manifest);
      await waitForLocalOwnerReady(directory);
      const owned = await proveLocalOwner(entry, directory);
      await this.owners.prove(entry.instanceId, owned.proof);
      this.entries.set(entry.instanceId, { ...entry, proof: owned.proof });
      this.proven.add(entry.instanceId);
      this.launching.delete(entry.instanceId);
      const raw = await this.bind(entry, launch, admission.signal, observer);
      // The bearer travels only through the private socket into the owner's memory.
      if (input.mcp)
        await this.control(entry, { kind: "bearer", token: input.mcp.token });
      // The scheduler wraps this exact proxy after the callback returns.
      return raw;
    } catch (error: unknown) {
      this.launching.delete(entry.instanceId);
      this.uncertain.add(entry.instanceId);
      logCaughtError("LocalSessions", error);
      throw new AcpCleanupUnconfirmedError();
    }
  }

  private async bind(
    entry: LocalSessionEntry,
    launch: LocalSessionLaunch,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<LocalAttachedSession> {
    const run = await this.runs.find(entry.runId);
    if (!run) throw new AgentError("plan_run_unavailable");
    const journal = new LocalSessionJournal(
      this.directory(entry.instanceId),
      run.planId,
      requireAgentFiles(this.input.database),
    );
    const owned = await proveLocalOwner(
      this.requireEntry(entry.instanceId),
      this.directory(entry.instanceId),
    );
    const token = randomUUID();
    await sendLocalCommand(owned.manifest, { kind: "attach", token });
    await this.owners.claim(entry.instanceId, token);
    this.attachments.set(entry.instanceId, token);
    const raw = new LocalAttachedSession(launch, signal, observer, {
      importer: new LocalSessionImport({
        database: this.input.database,
        owners: this.owners,
        entry,
        journal,
        token,
      }),
      control: (command) => this.control(entry, command),
      completion: (turnId) =>
        readLocalCompletion(
          this.owners,
          this.input.database,
          entry.instanceId,
          turnId,
        ),
      nextLaunch: (input) =>
        createLocalSessionLaunch(input, entry.instanceId, launch.mcp, 0),
      namespace: async (mutation) => {
        const namespace = mutation.details.namespace;
        if (namespace && isActivePlanRun(run.status))
          await this.input.resources.registerNamespace(
            entry.instanceId,
            namespace,
          );
        this.input.tools.supervisor.identify(entry.instanceId, {
          processId: mutation.details.processId,
        });
      },
    });
    this.attached.set(entry.instanceId, { raw, session: raw });
    await raw.attach();
    if (this.isDetaching) raw.detach();
    return raw;
  }

  private requireEntry(instanceId: string): LocalSessionEntry {
    const entry = this.entries.get(instanceId);
    if (!entry || !this.proven.has(instanceId))
      throw new AgentError("plan_local_owner_unverified");
    return entry;
  }

  private directory(instanceId: string): string {
    return localSessionDirectory(this.input.dataDirectory, instanceId);
  }

  private async control(
    entry: LocalSessionEntry,
    command: LocalSessionCommand,
  ): Promise<unknown> {
    const current = this.requireEntry(entry.instanceId);
    let owned: Awaited<ReturnType<typeof proveLocalOwner>>;
    try {
      owned = await proveLocalOwner(current, this.directory(entry.instanceId));
    } catch (error: unknown) {
      logCaughtError("LocalSessions", error);
      throw new AgentError("plan_local_owner_unverified");
    }
    return sendLocalCommand(
      owned.manifest,
      command,
      this.attachments.get(entry.instanceId),
    );
  }

  private async settleManaged(instanceId: string): Promise<boolean | null> {
    const entry = this.entries.get(instanceId);
    if (!entry) return null;
    if (entry.releasedAt) return true;
    if (this.finished.has(instanceId)) return false;
    if (this.uncertain.has(instanceId)) return this.settleEndedOwner(entry);
    let owned: Awaited<ReturnType<typeof proveLocalOwner>>;
    try {
      owned = await proveLocalOwner(
        this.requireEntry(instanceId),
        this.directory(instanceId),
      );
    } catch {
      this.proven.delete(instanceId);
      this.uncertain.add(instanceId);
      return this.settleEndedOwner(entry);
    }
    if (!this.attachments.has(instanceId)) {
      const token = randomUUID();
      await sendLocalCommand(owned.manifest, { kind: "attach", token });
      this.attachments.set(instanceId, token);
    }
    await this.control(entry, { kind: "cancel" });
    const result = await this.control(entry, { kind: "close" });
    if (typeof result !== "object" || result === null || !("closed" in result))
      throw new Error("Missing native closeout");
    const closed = localClosedSchema.parse(result.closed);
    return closed.isConfirmed;
  }

  private async settleEndedOwner(entry: LocalSessionEntry): Promise<boolean> {
    const instanceId = entry.instanceId;
    if (!(await hasEndedLocalOwner(entry, this.directory(instanceId))))
      throw new AgentError("plan_local_owner_unverified");
    if ((await settleWorkerUnits(instanceId)) !== 0) return false;
    await this.recordReleased(entry);
    return true;
  }

  private async settleFinishedEntry(entry: LocalSessionEntry): Promise<void> {
    const run = await this.runs.find(entry.runId);
    if (!run || isActivePlanRun(run.status)) return;
    const raw = await this.bind(
      entry,
      await readCurrentLocalLaunch(
        this.directory(entry.instanceId),
        this.requireEntry(entry.instanceId),
      ),
      new AbortController().signal,
      { started: () => undefined, identified: () => undefined },
    );
    const closed = await raw.close();
    await this.input.resources.completeAdopted(entry.instanceId, closed);
    if (closed.isConfirmed) await this.release(entry);
  }

  private async release(entry: LocalSessionEntry): Promise<void> {
    await this.control(entry, { kind: "release" });
    await this.recordReleased(entry);
  }

  private async recordReleased(entry: LocalSessionEntry): Promise<void> {
    await this.owners.released(entry.instanceId);
    this.entries.set(entry.instanceId, {
      ...entry,
      releasedAt: new Date().toISOString(),
    });
    this.proven.delete(entry.instanceId);
    this.uncertain.delete(entry.instanceId);
    this.attached.delete(entry.instanceId);
    this.input.tools.supervisor.release(entry.instanceId);
  }
}
