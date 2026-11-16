import { AgentError } from "@/backend/error/AgentErrors";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import {
  LOCAL_RUNNER_CONNECTION_ID,
  provisionLocalRunner,
} from "./LocalRunnerIdentity";
import {
  readRunnerProgress,
  readRunnerAvailability,
} from "./RunnerServiceSupport";
import { rememberReconcileCapabilities } from "./RunnerReconcileCapabilities";
import { RunnerIdentityService } from "./RunnerIdentityService";
import { RunnerExecutionPause } from "./RunnerExecutionPause";
import { runnerWireState } from "./RunnerProtocol";
import { parseRunnerMessage } from "./RunnerMessageIntake";
import { checkpointRunnerMessage } from "./RunnerMessageCheckpoint";
import { runnerTools, runnerConnectionView } from "./RunnerConnectionFacts";
import { requireRunnerOutputExecutor } from "./RunnerOutputCapabilities";
import { RunnerObservation } from "./RunnerObservation";
import { RunnerHostFeatures } from "./RunnerHostFeatures";
import { RunnerJobQueue } from "./RunnerJobQueue";
import { RunnerQueuedPause } from "./RunnerQueuedPause";
import { RunnerCancellation } from "./RunnerCancellation";
import { RunnerContacts } from "./RunnerContacts";
import {
  compatibleRunnerCatalog,
  isRunnerCatalogCurrent,
} from "./RunnerCatalog";

import type {
  RunnerStore,
  RunnerConnectionAccess,
} from "./RunnerServiceSupport";
import type { RunnerCatalog } from "@/definition/RunnerProtocol";
import type { RunnerContact } from "./RunnerContacts";
import type {
  RunnerExecution,
  RunnerInterpreter,
} from "@/definition/RunnerExecution";
import type { ToolInventory } from "@/definition/RemoteSetup";
import type { RunnerPlanEventService } from "./RunnerPlanEventService";
import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type {
  RunnerConnectionView,
  RunnerJob,
  RunnerPlanBinding,
  RunnerReply,
  RunnerMessage,
} from "@/definition/RunnerProtocol";

/** Credential returned once, over the authenticated runner channel only. */
export interface RunnerAuthentication {
  readonly connectionId: string;
  readonly runnerId: string;
  readonly token: string | null;
  readonly sessionId: string;
}

/** Authorizes short-lived pairing and maintains durable sessions independently of SSH transports. */
export class RunnerService {
  private readonly repository: RunnerStore;
  private managedCleanup: ((job: RunnerJob) => Promise<void>) | undefined;
  private readonly events: RunnerPlanEventService | undefined;
  private readonly connections: RunnerConnectionAccess;
  private readonly identity: RunnerIdentityService;
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
  private readonly pagesExecutors = new Map<string, 1 | 2 | 3>();
  private readonly openCodeExecutors = new Set<string>();
  private readonly liveExecutors = new Set<string>();
  private readonly outputExecutors = new Set<string>();
  private readonly exactPayloadExecutors = new Set<string>();
  private readonly continuationExecutors = new Set<string>();
  private readonly hostFeatures = new RunnerHostFeatures();
  private readonly knownOutputVersions = new Map<string, 1 | 2>();
  private readonly observation = new RunnerObservation();
  private readonly communicationExecutors = new Set<string>();
  private readonly cancellation: RunnerCancellation;
  private readonly jobs: RunnerJobQueue;

  public constructor(
    repository: RunnerStore,
    connections: RunnerConnectionAccess,
    events?: RunnerPlanEventService,
  ) {
    this.repository = repository;
    this.events = events;
    this.connections = connections;
    this.identity = new RunnerIdentityService({
      repository,
      connections,
      writes: this.writes,
      requireSetup: (userId, connectionId) =>
        this.requireSetup(userId, connectionId),
      requireRevision: (record) => this.requireRevision(record),
    });
    this.cancellation = new RunnerCancellation({
      repository,
      writes: this.writes,
      deliver: (connectionId, reply) => this.deliver(connectionId, reply),
      expire: (connectionId, job) =>
        this.events?.expireStop(connectionId, job) ?? Promise.resolve(),
    });
    this.jobs = new RunnerJobQueue({
      repository,
      events,
      writes: this.writes,
      requireUsable: (userId, connectionId) =>
        this.requireUsable(userId, connectionId),
      requireRevision: (record) => this.requireRevision(record),
      checkOutput: (record, execution) =>
        requireRunnerOutputExecutor({
          execution,
          executionLeaseVersion: record.state.executionLeaseVersion,
          isOnline: this.contacts.isOnline(record.connectionId),
          hasCommunication: this.communicationExecutors.has(
            record.connectionId,
          ),
          hasExactPayload: this.supportsExactResultPayload(record.connectionId),
          hasOutputJournal: this.outputExecutors.has(record.connectionId),
          hasLiveHistory: this.liveExecutors.has(record.connectionId),
          runnerVersion: record.state.runnerVersion,
        }),
      dispatch: (connectionId, job, state) => {
        if (state)
          this.deliver(connectionId, {
            version: 1,
            type: "reconcile",
            state: runnerWireState(state),
            outputJournalVersion: 2,
            communicationVersion: 1,
            planControlVersion: 1,
          });
        else this.deliver(connectionId, { version: 1, type: "dispatch", job });
      },
      observe: (connectionId, jobs) => {
        this.observation.configure(
          connectionId,
          jobs,
          this.liveExecutors.has(connectionId),
        );
        if (this.channels.has(connectionId))
          this.observation.attach(connectionId, (reply) =>
            this.deliver(connectionId, reply),
          );
      },
      hasLiveHistory: (connectionId) => this.liveExecutors.has(connectionId),
    });
  }

  /** Lists actual SSH registrations; absent runners never generate invented agent rows. */
  public async overview(
    userId: string,
  ): Promise<readonly RunnerConnectionView[]> {
    const scope = await this.connections.scope(userId);
    if (!scope.canManage) throw new Error("Runner administration required");
    const remote = await Promise.all(
      scope.connections.map((connection) => this.connectionView(connection)),
    );
    const record = await this.writes.run(() =>
      provisionLocalRunner(this.repository),
    );
    if (!record) return remote;
    return [
      {
        connectionId: LOCAL_RUNNER_CONNECTION_ID,
        name: "",
        endpoint: "127.0.0.1",
        isLocal: true,
        departmentName: null,
        isStable: true,
        runnerId: record.runnerId,
        isOnline: this.contacts.isOnline(LOCAL_RUNNER_CONNECTION_ID),
        checkedAt:
          this.contact(LOCAL_RUNNER_CONNECTION_ID).lastContactAt ??
          record.state.lastContactAt ??
          null,
        tools: runnerTools(record, this.tools.get(LOCAL_RUNNER_CONNECTION_ID)),
        runnerVersion: record.state.runnerVersion ?? null,
        communicationVersion: record.state.communicationVersion ?? null,
        outputJournalVersion:
          this.knownOutputVersions.get(LOCAL_RUNNER_CONNECTION_ID) ?? null,
        canFreezeExecution: record.state.cgroupVersion === 1,
      },
      ...remote,
    ];
  }

  /** Issues a single-use grant, bound to the administrator and current SSH revision. */
  public async authorize(
    userId: string,
    connectionId: string,
  ): Promise<{ readonly grant: string; readonly expiresAt: string }> {
    return this.identity.authorize(userId, connectionId);
  }

  /** Consumes a grant or verifies a stored token before any WebSocket upgrade. */
  public async authenticate(
    connectionId: string,
    credential: string,
  ): Promise<RunnerAuthentication> {
    return this.identity.authenticate(connectionId, credential);
  }

  /** Validates and checkpoints one message before making its acknowledgement observable. */
  public async receive(
    connectionId: string,
    input: unknown,
  ): Promise<RunnerReply> {
    const message = parseRunnerMessage(connectionId, input);
    const reply = await this.writes.run(async () => {
      const record = await this.repository.find(connectionId);
      if (!record) throw new Error("Runner registration missing");
      await this.requireRevision(record);
      // A failed reconnect must not retain the preceding channel's capability.
      if (
        message.type === "reconcile" &&
        message.sessionId === record.state.sessionId
      ) {
        this.exactPayloadExecutors.delete(connectionId);
        this.continuationExecutors.delete(connectionId);
        this.hostFeatures.forget(connectionId);
      }
      this.rememberOutputCapability(
        connectionId,
        message,
        record.state.sessionId,
      );
      const result = await checkpointRunnerMessage({
        connectionId,
        repository: this.repository,
        events: this.events,
        closeManaged: this.managedCleanup,
        record,
        message,
      });
      if (!this.contacts.isOnline(connectionId))
        await this.repository.reconnected?.(connectionId);
      this.heartbeat(connectionId);
      if (message.type === "reconcile")
        rememberReconcileCapabilities(
          {
            hostFeatures: this.hostFeatures,
            communicationExecutors: this.communicationExecutors,
            liveExecutors: this.liveExecutors,
            pagesExecutors: this.pagesExecutors,
            githubProbes: this.githubProbes,
            cliExecutors: this.cliExecutors,
            openCodeExecutors: this.openCodeExecutors,
            exactPayloadExecutors: this.exactPayloadExecutors,
            continuationExecutors: this.continuationExecutors,
            interpreters: this.interpreters,
            tools: this.tools,
          },
          connectionId,
          message,
        );
      this.observation.configure(
        connectionId,
        result.state.jobs,
        this.liveExecutors.has(connectionId),
      );
      return result.reply;
    });
    return this.events?.restoreHistory(connectionId, message, reply) ?? reply;
  }

  /** Attaches credential cleanup to confirmed runner receipts, independently of scheduler lifetime. */
  public attachManagedCleanup(
    cleanup: (job: RunnerJob) => Promise<void>,
  ): void {
    this.managedCleanup = cleanup;
  }

  /** Records a job before dispatch; callers retain its ID instead of resubmitting after a loss. */
  public async enqueue(
    userId: string,
    connectionId: string,
    plan?: RunnerPlanBinding,
    execution?: RunnerExecution,
  ): Promise<RunnerJob> {
    return this.jobs.enqueue(userId, connectionId, plan, execution);
  }

  /** Follows a finished job of the same frozen attempt with one explicitly requested retry job. */
  public async enqueueRetry(
    userId: string,
    connectionId: string,
    plan: RunnerPlanBinding,
    execution: RunnerExecution,
  ): Promise<RunnerJob> {
    return this.jobs.enqueueRetry(userId, connectionId, plan, execution);
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
    this.continuationExecutors.delete(connectionId);
    this.hostFeatures.forget(connectionId);
    this.observation.detach(connectionId);
  }

  /**
   * Pages' own view of a runner, independent of what a machine reports about itself.
   * @remarks
   * Paired means a registration of the current SSH configuration exists;
   * ready means that runner reported within the heartbeat window and attached
   * its executor. Neither follows from a running service on the machine.
   * @param connectionId - The SSH connection.
   * @returns The two facts.
   */
  public async status(
    connectionId: string,
  ): Promise<{ readonly isPaired: boolean; readonly isReady: boolean }> {
    const record = await this.repository.find(connectionId);
    if (!record) return { isPaired: false, isReady: false };
    const revision = await this.connectionRevision(connectionId);
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
    if (connectionId === LOCAL_RUNNER_CONNECTION_ID) {
      await this.requireUsable(userId, connectionId);
      if (!(await this.status(connectionId)).isReady)
        throw new Error("Local runner unavailable");
      return;
    }
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
    return (this.pagesExecutors.get(connectionId) ?? 0) >= 2;
  }

  /** Asset v3 also receives files above 10 MiB, up to 512 MiB, written to disk chunk by chunk. */
  public supportsLargeAssetFiles(connectionId: string): boolean {
    return this.pagesExecutors.get(connectionId) === 3;
  }

  /** Runners before 1.7.0 list OpenCode by version only and cannot run it over ACP. */
  public supportsOpenCode(connectionId: string): boolean {
    return this.openCodeExecutors.has(connectionId);
  }

  /** The live runner can return versioned CLI results without a provenance prefix. */
  public supportsExactResultPayload(connectionId: string): boolean {
    return this.exactPayloadExecutors.has(connectionId);
  }

  /** The live runner keeps a resumable native session for a writing CLI job and proves its tool activity. */
  public supportsContinuation(connectionId: string): boolean {
    return this.continuationExecutors.has(connectionId);
  }

  /** The live runner supports independently authenticated host-local agent homes. */
  public supportsAgentAccounts(connectionId: string): boolean {
    return this.hostFeatures.supportsAccounts(connectionId);
  }

  /** The live runner has an explicitly configured sandboxed browser MCP executable. */
  public supportsBrowser(connectionId: string): boolean {
    return this.hostFeatures.supportsBrowser(connectionId);
  }

  /** The live runner reports structured native TODO and token events. */
  public supportsProgress(connectionId: string): boolean {
    return this.hostFeatures.supportsProgress(connectionId);
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
    return readRunnerAvailability({
      status: () => this.status(connectionId),
      hasCommunication: this.communicationExecutors.has(connectionId),
      record: () => this.repository.find(connectionId),
      catalog: () => this.catalog(connectionId),
    });
  }

  /** Reads retained metadata only for the still-current authenticated SSH identity. */
  public async catalog(
    connectionId: string,
  ): Promise<RunnerCatalog | undefined> {
    const record = await this.repository.find(connectionId);
    if (
      !record ||
      record.connectionRevision !==
        (await this.connectionRevision(connectionId))
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

  /** Pauses only a job that the Runner can exclusively prove was never spawned. */
  public async pauseQueued(connectionId: string, jobId: string): Promise<void> {
    await new RunnerQueuedPause(
      this.repository,
      this.writes,
      (connection, reply) => this.deliver(connection, reply),
    ).request(connectionId, jobId);
  }

  /** Suspends or resumes the same durable worker without releasing its job. */
  public async pauseExecution(
    connectionId: string,
    jobId: string,
    isPaused: boolean,
  ): Promise<void> {
    await new RunnerExecutionPause(
      this.repository,
      this.writes,
      (connection, reply) => this.deliver(connection, reply),
    ).request(connectionId, jobId, isPaused);
  }

  /** Returns journal facts for an already-authorized exact run and attempt. */
  public async progress(
    connectionId: string,
    runId: string,
    attemptId: string,
  ): Promise<RunnerJob | undefined> {
    return readRunnerProgress(this.repository, connectionId, runId, attemptId);
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
    if (connectionId === LOCAL_RUNNER_CONNECTION_ID)
      throw new Error("The local runner is managed by the installation");
    await this.writes.run(async () => {
      const scope = await this.connections.scope(userId);
      if (!scope.canManage) throw new Error("Runner administration required");
      await this.repository.remove(connectionId);
      this.knownOutputVersions.delete(connectionId);
      this.identity.forget(connectionId);
      this.disconnected(connectionId);
    });
  }

  /** Rechecks the same setup condition server-side immediately before transfer or pairing. */
  public async requireSetup(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const scope = await this.connections.scope(userId);
    if (!scope.canManage) throw new Error("Runner administration required");
    const connection = scope.connections.find(
      (entry) => entry.id === connectionId,
    );
    const row = connection ? await this.connectionView(connection) : undefined;
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

  private async requireUsable(
    userId: string,
    connectionId: string,
  ): Promise<{ readonly revision: number }> {
    if (connectionId !== LOCAL_RUNNER_CONNECTION_ID)
      return this.connections.requireUsable(userId, connectionId);
    await this.connections.scope(userId);
    if (!process.env.PAGES_LOCAL_RUNNER_CONFIG)
      throw new Error("Local runner not installed");
    return { revision: 1 };
  }

  private async connectionRevision(connectionId: string): Promise<number> {
    return connectionId === LOCAL_RUNNER_CONNECTION_ID &&
      process.env.PAGES_LOCAL_RUNNER_CONFIG
      ? 1
      : this.connections.scopeForRunner(connectionId);
  }

  private async requireRevision(record: RunnerRecord): Promise<void> {
    const scope = await this.connectionRevision(record.connectionId);
    if (scope !== record.connectionRevision)
      throw new Error("Runner connection revoked or changed");
  }
}
