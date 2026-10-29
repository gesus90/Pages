import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { registerLogSecret } from "@/backend/logging/LogRedaction";
import {
  runnerMessageSchema,
  runnerPlanBindingSchema,
} from "@/definition/RunnerProtocol";
import { runnerExecutionSchema } from "@/definition/RunnerExecution";

import { checkpointRunnerMessage } from "./RunnerMessageCheckpoint";
import { runnerConnectionView } from "./RunnerConnectionFacts";
import { requireRunnerOutputExecutor } from "./RunnerOutputCapabilities";
import { RunnerObservation } from "./RunnerObservation";
import { RunnerCancellation } from "./RunnerCancellation";
import { RunnerContacts } from "./RunnerContacts";
import {
  compatibleRunnerCatalog,
  isRunnerCatalogCurrent,
} from "./RunnerCatalog";

import type { RunnerCatalog } from "@/definition/RunnerProtocol";
import type { RunnerContact } from "./RunnerContacts";
import type {
  RunnerExecution,
  RunnerInterpreter,
} from "@/definition/RunnerExecution";
import type { ToolInventory } from "@/definition/RemoteSetup";
import type { RunnerPlanEventService } from "./RunnerPlanEventService";
import type {
  RunnerRepository,
  RunnerRecord,
} from "@/backend/database/repositories/runner/RunnerRepository";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type {
  RunnerConnectionView,
  RunnerJob,
  RunnerPlanBinding,
  RunnerReply,
  RunnerMessage,
} from "@/definition/RunnerProtocol";

interface RegistrationGrant {
  readonly digest: string;
  readonly userId: string;
  readonly revision: number;
  readonly expiresAt: number;
}

type RunnerStore = Pick<
  RunnerRepository,
  "find" | "create" | "checkpoint" | "remove"
>;
type RunnerConnectionAccess = Pick<
  RemoteConnectionService,
  "scope" | "scopeForRunner" | "requireUsable"
>;

/** Credential returned once, over the authenticated runner channel only. */
export interface RunnerAuthentication {
  readonly connectionId: string;
  readonly runnerId: string;
  readonly token: string | null;
  readonly sessionId: string;
}

const GRANT_MILLISECONDS = 120_000;

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function matches(token: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(digest(token), "hex"),
    Buffer.from(expected, "hex"),
  );
}

/** Authorizes short-lived pairing and maintains durable sessions independently of SSH transports. */
export class RunnerService {
  private readonly repository: RunnerStore;
  private readonly events: RunnerPlanEventService | undefined;
  private readonly connections: RunnerConnectionAccess;
  private readonly grants = new Map<string, RegistrationGrant>();
  private readonly contacts = new RunnerContacts();
  private readonly writes = new SerialQueue();
  private readonly channels = new Map<string, (reply: RunnerReply) => void>();
  private readonly interpreters = new Map<
    string,
    readonly RunnerInterpreter[]
  >();
  private readonly tools = new Map<string, readonly ToolInventory[]>();
  private readonly cliExecutors = new Set<string>();
  private readonly githubProbes = new Set<string>();
  private readonly pagesExecutors = new Map<string, 1 | 2>();
  private readonly openCodeExecutors = new Set<string>();
  private readonly liveExecutors = new Set<string>();
  private readonly outputExecutors = new Set<string>();
  private readonly exactPayloadExecutors = new Set<string>();
  private readonly knownOutputVersions = new Map<string, 1 | 2>();
  private readonly observation = new RunnerObservation();
  private readonly communicationExecutors = new Set<string>();
  private readonly cancellation: RunnerCancellation;

  public constructor(
    repository: RunnerStore,
    connections: RunnerConnectionAccess,
    events?: RunnerPlanEventService,
  ) {
    this.repository = repository;
    this.events = events;
    this.connections = connections;
    this.cancellation = new RunnerCancellation({
      repository,
      writes: this.writes,
      deliver: (connectionId, reply) => this.deliver(connectionId, reply),
      expire: (connectionId, job) =>
        this.events?.expireStop(connectionId, job) ?? Promise.resolve(),
    });
  }

  /** Lists actual SSH registrations; absent runners never generate invented agent rows. */
  public async overview(
    userId: string,
  ): Promise<readonly RunnerConnectionView[]> {
    const scope = await this.connections.scope(userId);
    if (!scope.canManage) throw new Error("Runner administration required");
    return Promise.all(
      scope.connections.map((connection) => this.connectionView(connection)),
    );
  }

  /** Issues a single-use grant, bound to the administrator and current SSH revision. */
  public async authorize(
    userId: string,
    connectionId: string,
  ): Promise<{ readonly grant: string; readonly expiresAt: string }> {
    return this.writes.run(async () => {
      await this.requireSetup(userId, connectionId);
      for (const [id, grant] of this.grants)
        if (grant.expiresAt <= Date.now()) this.grants.delete(id);
      const connection = await this.connections.requireUsable(
        userId,
        connectionId,
      );
      const token = randomBytes(32).toString("base64url");
      registerLogSecret(token);
      const expiresAt = Date.now() + GRANT_MILLISECONDS;
      this.grants.set(connectionId, {
        digest: digest(token),
        userId,
        revision: connection.revision,
        expiresAt,
      });
      return { grant: token, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  /** Consumes a grant or verifies a stored token before any WebSocket upgrade. */
  public async authenticate(
    connectionId: string,
    credential: string,
  ): Promise<RunnerAuthentication> {
    return this.writes.run(async () => {
      if (credential.length > 200) throw new Error("Invalid runner credential");
      const record = await this.repository.find(connectionId);
      if (record) {
        await this.requireRevision(record);
        if (!matches(credential, record.tokenHash))
          throw new Error("Invalid runner credential");
        return {
          connectionId,
          runnerId: record.runnerId,
          token: null,
          sessionId: record.state.sessionId,
        };
      }
      const grant = this.grants.get(connectionId);
      if (
        !grant ||
        grant.expiresAt <= Date.now() ||
        !matches(credential, grant.digest)
      )
        throw new Error("Invalid runner grant");
      await this.requireSetup(grant.userId, connectionId);
      const connection = await this.connections.requireUsable(
        grant.userId,
        connectionId,
      );
      if (connection.revision !== grant.revision)
        throw new Error("Runner configuration changed");
      this.grants.delete(connectionId);
      const token = randomBytes(32).toString("base64url");
      registerLogSecret(token);
      const created: RunnerRecord = {
        connectionId,
        runnerId: randomUUID(),
        tokenHash: digest(token),
        connectionRevision: connection.revision,
        state: {
          version: 1,
          sessionId: randomUUID(),
          sequence: 0,
          lastEventId: null,
          jobs: [],
        },
      };
      await this.repository.create(created);
      return {
        connectionId,
        runnerId: created.runnerId,
        token,
        sessionId: created.state.sessionId,
      };
    });
  }

  /** Validates and checkpoints one message before making its acknowledgement observable. */
  public async receive(
    connectionId: string,
    input: unknown,
  ): Promise<RunnerReply> {
    const message = runnerMessageSchema.parse(input);
    const reply = await this.writes.run(async () => {
      const record = await this.repository.find(connectionId);
      if (!record) throw new Error("Runner registration missing");
      await this.requireRevision(record);
      // A failed reconnect must not retain the preceding channel's capability.
      if (
        message.type === "reconcile" &&
        message.sessionId === record.state.sessionId
      )
        this.exactPayloadExecutors.delete(connectionId);
      this.rememberOutputCapability(
        connectionId,
        message,
        record.state.sessionId,
      );
      const result = await checkpointRunnerMessage({
        connectionId,
        repository: this.repository,
        events: this.events,
        record,
        message,
      });
      this.heartbeat(connectionId);
      if (message.type === "reconcile") {
        if (message.communicationVersion === 1)
          this.communicationExecutors.add(connectionId);
        else this.communicationExecutors.delete(connectionId);
        if (message.liveHistoryVersion === 1)
          this.liveExecutors.add(connectionId);
        else this.liveExecutors.delete(connectionId);
        if (message.pagesAccessVersion)
          this.pagesExecutors.set(connectionId, message.pagesAccessVersion);
        else this.pagesExecutors.delete(connectionId);
        if (message.githubAccessVersion === 1)
          this.githubProbes.add(connectionId);
        else this.githubProbes.delete(connectionId);
        if (message.cliExecutorVersion === 1)
          this.cliExecutors.add(connectionId);
        else this.cliExecutors.delete(connectionId);
        if (message.openCodeExecutorVersion === 1)
          this.openCodeExecutors.add(connectionId);
        else this.openCodeExecutors.delete(connectionId);
        if (message.resultPayloadVersion === 1)
          this.exactPayloadExecutors.add(connectionId);
        else this.exactPayloadExecutors.delete(connectionId);
        if (message.executorVersion === 1 && message.interpreters)
          this.interpreters.set(connectionId, message.interpreters);
        if (message.tools) this.tools.set(connectionId, message.tools);
        else this.tools.delete(connectionId);
      }
      this.observation.configure(
        connectionId,
        result.state.jobs,
        this.liveExecutors.has(connectionId),
      );
      return result.reply;
    });
    return this.events?.restoreHistory(connectionId, message, reply) ?? reply;
  }

  /** Records a job before dispatch; callers retain its ID instead of resubmitting after a loss. */
  public async enqueue(
    userId: string,
    connectionId: string,
    plan?: RunnerPlanBinding,
    execution?: RunnerExecution,
  ): Promise<RunnerJob> {
    if (execution) runnerExecutionSchema.parse(execution);
    if (Buffer.byteLength(JSON.stringify(execution) ?? "", "utf8") > 1_000_000)
      throw new Error("Runner command exceeds transport budget");
    const binding = plan ? runnerPlanBindingSchema.parse(plan) : undefined;
    await this.connections.requireUsable(userId, connectionId);
    return this.writes.run(async () => {
      const record = await this.repository.find(connectionId);
      if (!record) throw new Error("Runner queue unavailable");
      await this.requireRevision(record);
      if (binding) {
        if (!this.events) throw new Error("Runner plan binding unavailable");
        await this.events.authorizeBinding(userId, connectionId, binding);
        const previous = record.state.jobs.find(
          (job) => job.plan?.attemptId === binding.attemptId,
        );
        if (previous) {
          if (planContentDigest(previous.plan) !== planContentDigest(binding))
            throw new Error("Conflicting runner plan binding");
          if (
            planContentDigest(previous.execution) !==
            planContentDigest(execution)
          )
            throw new Error("Conflicting runner command");
          return previous;
        }
      }
      requireRunnerOutputExecutor({
        execution,
        executionLeaseVersion: record.state.executionLeaseVersion,
        isOnline: this.contacts.isOnline(connectionId),
        hasCommunication: this.communicationExecutors.has(connectionId),
        hasExactPayload: this.supportsExactResultPayload(connectionId),
        hasOutputJournal: this.outputExecutors.has(connectionId),
        hasLiveHistory: this.liveExecutors.has(connectionId),
        runnerVersion: record.state.runnerVersion,
      });
      if (record.state.jobs.length >= 1000)
        throw new Error("Runner queue unavailable");
      const job: RunnerJob = {
        ...(this.liveExecutors.has(connectionId) &&
        execution?.program.kind === "cli"
          ? {
              liveHistoryVersion: 1 as const,
              outputJournalVersion: 2 as const,
              historyCursor: 0,
            }
          : {}),
        ...(binding ? { plan: binding } : {}),
        ...(execution ? { execution } : {}),
        jobId: randomUUID(),
        sessionId: record.state.sessionId,
        status: "queued",
      };
      await this.repository.checkpoint(
        connectionId,
        {
          ...record.state,
          jobs: [...record.state.jobs, job],
        },
        (transaction) =>
          binding
            ? (this.events?.requireDispatchFence(transaction, binding) ??
              Promise.resolve())
            : Promise.resolve(),
      );
      this.deliver(connectionId, { version: 1, type: "dispatch", job });
      this.observation.configure(
        connectionId,
        [...record.state.jobs, job],
        this.liveExecutors.has(connectionId),
      );
      if (this.channels.has(connectionId))
        this.observation.attach(connectionId, (reply) =>
          this.deliver(connectionId, reply),
        );
      return job;
    });
  }

  /** Drops live status after a closed or expired socket. */
  public disconnected(connectionId: string): void {
    this.contacts.forget(connectionId);
    this.communicationExecutors.delete(connectionId);
    this.cliExecutors.delete(connectionId);
    this.githubProbes.delete(connectionId);
    this.pagesExecutors.delete(connectionId);
    this.openCodeExecutors.delete(connectionId);
    this.liveExecutors.delete(connectionId);
    this.outputExecutors.delete(connectionId);
    this.exactPayloadExecutors.delete(connectionId);
    this.observation.detach(connectionId);
  }

  /**
   * Pages' own view of a runner, independent of what a machine reports about itself.
   *
   * @remarks
   * Paired means a registration of the current SSH configuration exists;
   * ready means that runner reported within the heartbeat window and attached
   * its executor. Neither follows from a running service on the machine.
   *
   * @param connectionId - The SSH connection.
   * @returns The two facts.
   */
  public async status(
    connectionId: string,
  ): Promise<{ readonly isPaired: boolean; readonly isReady: boolean }> {
    const record = await this.repository.find(connectionId);
    if (!record) return { isPaired: false, isReady: false };
    const revision = await this.connections.scopeForRunner(connectionId);
    const isPaired = record.connectionRevision === revision;
    const isOnline = this.contacts.isOnline(connectionId);
    return {
      isPaired,
      isReady: isPaired && isOnline && this.interpreters.has(connectionId),
    };
  }

  /** Requires a live registration under current administrator access and SSH revision. */
  public async requireOnline(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const row = (await this.overview(userId)).find(
      (entry) => entry.connectionId === connectionId,
    );
    if (!row?.isOnline) throw new Error("Online runner required");
    const record = await this.repository.find(connectionId);
    if (!record) throw new Error("Runner registration missing");
    await this.requireRevision(record);
  }

  /** Attaches execution only after reconciliation; queued claims retain their original identity. */
  public attach(
    connectionId: string,
    send: (reply: RunnerReply) => void,
  ): () => void {
    this.channels.set(connectionId, send);
    this.cancellation.replay(connectionId);
    this.observation.attach(connectionId, (reply) =>
      this.deliver(connectionId, reply),
    );
    return () => {
      if (this.channels.get(connectionId) === send)
        this.channels.delete(connectionId);
    };
  }

  /** Drops the current execution sender after its socket closes. */
  public detach(connectionId: string): void {
    this.channels.delete(connectionId);
    this.observation.detach(connectionId);
  }

  /** Renews a plan view after its route has checked the reader's current rights. */
  public observePlan(planId: string, isOpening: boolean): void {
    this.observation.observe(planId, isOpening);
  }

  /** Requires an executing runner, rather than a transport-only bootstrap. */
  public async ready(
    userId: string,
    connectionId: string,
  ): Promise<readonly RunnerInterpreter[]> {
    await this.requireOnline(userId, connectionId);
    if (this.communicationExecutors.has(connectionId)) {
      const catalog = await this.catalog(connectionId);
      if (!isRunnerCatalogCurrent(catalog))
        throw new AgentError("plan_remote_unavailable");
      return (
        catalog?.interpreters.filter(
          (entry) => !catalog.removedInterpreterIds.includes(entry.id),
        ) ?? []
      );
    }
    const interpreters = this.interpreters.get(connectionId);
    if (!interpreters) throw new Error("Runner executor unavailable");
    return interpreters;
  }

  /** Reports the probe capability explicitly; older runners never receive an unknown command. */
  public supportsGitHubAccess(connectionId: string): boolean {
    return this.githubProbes.has(connectionId);
  }

  /** Older runners retain text execution but cannot receive resource/Pages requests. */
  public supportsPagesAccess(connectionId: string): boolean {
    return this.pagesExecutors.has(connectionId);
  }

  /** Asset v2 preserves original MIME, source metadata and authorized workspace copies. */
  public supportsAssetFiles(connectionId: string): boolean {
    return this.pagesExecutors.get(connectionId) === 2;
  }

  /** Runners before 1.7.0 list OpenCode by version only and cannot run it over ACP. */
  public supportsOpenCode(connectionId: string): boolean {
    return this.openCodeExecutors.has(connectionId);
  }

  /** The live runner can return versioned CLI results without a provenance prefix. */
  public supportsExactResultPayload(connectionId: string): boolean {
    return this.exactPayloadExecutors.has(connectionId);
  }

  /** Resolves a live job from Pages' journal; a runner cannot choose another connection's attempt. */
  public async pagesJob(
    connectionId: string,
    jobId: string,
  ): Promise<RunnerJob> {
    const record = await this.repository.find(connectionId);
    if (!record || !this.supportsPagesAccess(connectionId))
      throw new Error("Pages runner unavailable");
    await this.requireRevision(record);
    const job = record.state.jobs.find((entry) => entry.jobId === jobId);
    if (
      !job?.plan ||
      job.execution?.pagesAccess !== 1 ||
      !["queued", "accepted", "running"].includes(job.status)
    )
      throw new Error("Pages job unavailable");
    return job;
  }

  /** Returns CLI facts only from a runner that implements CLI execution. */
  public async cliInventory(
    userId: string,
    connectionId: string,
  ): Promise<readonly ToolInventory[]> {
    await this.ready(userId, connectionId);
    if (this.communicationExecutors.has(connectionId))
      return (await this.catalog(connectionId))?.tools ?? [];
    return this.cliExecutors.has(connectionId) &&
      this.outputExecutors.has(connectionId)
      ? (this.tools.get(connectionId) ?? [])
      : [];
  }

  /** Distinguishes invalid pairing from a disconnected or outdated executor. */
  public async availability(
    connectionId: string,
  ): Promise<
    | "remoteIdentity"
    | "remoteOffline"
    | "remoteRunnerUpdate"
    | "remoteCatalogStale"
    | null
  > {
    const status = await this.status(connectionId);
    if (!status.isPaired) return "remoteIdentity";
    if (!status.isReady) return "remoteOffline";
    if (
      !this.communicationExecutors.has(connectionId) ||
      (await this.repository.find(connectionId))?.state
        .executionLeaseVersion !== 1
    )
      return "remoteRunnerUpdate";
    return isRunnerCatalogCurrent(await this.catalog(connectionId))
      ? null
      : "remoteCatalogStale";
  }

  /** Reads retained metadata only for the still-current authenticated SSH identity. */
  public async catalog(
    connectionId: string,
  ): Promise<RunnerCatalog | undefined> {
    const record = await this.repository.find(connectionId);
    if (
      !record ||
      record.connectionRevision !==
        (await this.connections.scopeForRunner(connectionId))
    )
      return undefined;
    return compatibleRunnerCatalog(
      record.state.catalog,
      record.state.runnerVersion,
    );
  }

  /** Persists stop intent against the original durable claim before delivery. */
  public async cancel(connectionId: string, jobId: string): Promise<void> {
    await this.cancellation.request(connectionId, jobId);
  }

  /** Returns journal facts for an already-authorized exact run and attempt. */
  public async progress(
    connectionId: string,
    runId: string,
    attemptId: string,
  ): Promise<RunnerJob | undefined> {
    const record = await this.repository.find(connectionId);
    return record?.state.jobs.find(
      (job) => job.plan?.runId === runId && job.plan.attemptId === attemptId,
    );
  }

  /** Pending archive import never implies pending execution or cleanup. */
  public async historyPending(jobId: string): Promise<number> {
    return this.events?.historyPending(jobId) ?? 0;
  }

  /** Transport liveness is independent of process output and last confirmed job state. */
  public contact(connectionId: string): RunnerContact {
    return this.contacts.contact(connectionId);
  }

  /**
   * Lets runner facts settle a stopped plan run that no engine of this process drives.
   *
   * @param isOwned - Whether the plan engine still drives the run.
   */
  public attachRunOwnership(isOwned: (runId: string) => boolean): void {
    this.events?.attachRunOwnership(isOwned);
  }

  /** Called only by the authenticated current channel after validating its session. */
  public heartbeat(connectionId: string): void {
    this.contacts.seen(connectionId);
  }

  /** Requests fresh CLI login and picker facts without signing in or starting a model turn. */
  public async refreshTools(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    await this.requireOnline(userId, connectionId);
    this.deliver(connectionId, { version: 1, type: "refresh-tools" });
  }

  /** Explicitly revokes the machine credential and its registration grant. */
  public async revoke(userId: string, connectionId: string): Promise<void> {
    await this.writes.run(async () => {
      const scope = await this.connections.scope(userId);
      if (!scope.canManage) throw new Error("Runner administration required");
      await this.repository.remove(connectionId);
      this.knownOutputVersions.delete(connectionId);
      this.grants.delete(connectionId);
      this.disconnected(connectionId);
    });
  }

  /** Rechecks the same setup condition server-side immediately before transfer or pairing. */
  public async requireSetup(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const row = (await this.overview(userId)).find(
      (entry) => entry.connectionId === connectionId,
    );
    if (!row?.isStable || row.runnerId !== null)
      throw new Error("Stable SSH connection without runner required");
    // A changed SSH revision invalidates the old identity, but never silently replaces it.
    if (await this.repository.find(connectionId))
      throw new Error("Existing runner requires administrative removal");
  }

  private rememberOutputCapability(
    connectionId: string,
    message: RunnerMessage,
    sessionId: string,
  ): void {
    if (message.type !== "reconcile" || message.sessionId !== sessionId) return;
    const version = message.outputJournalVersion ?? 1;
    this.knownOutputVersions.set(connectionId, version);
    if (version === 2) this.outputExecutors.add(connectionId);
    else this.outputExecutors.delete(connectionId);
  }

  private deliver(connectionId: string, reply: RunnerReply): void {
    try {
      this.channels.get(connectionId)?.(reply);
    } catch {
      // A lost transport must not turn an already durable claim into a failed, repeatable start.
      this.detach(connectionId);
      this.disconnected(connectionId);
    }
  }

  private async connectionView(
    connection: RemoteConnectionView,
  ): Promise<RunnerConnectionView> {
    const record = await this.repository.find(connection.id);
    return runnerConnectionView(connection, record, {
      outputJournalVersion: this.knownOutputVersions.get(connection.id) ?? null,
      isOnline: this.contacts.isOnline(connection.id),
      tools: this.tools.get(connection.id),
    });
  }

  private async requireRevision(record: RunnerRecord): Promise<void> {
    const scope = await this.connections.scopeForRunner(record.connectionId);
    if (scope !== record.connectionRevision)
      throw new Error("Runner connection revoked or changed");
  }
}
