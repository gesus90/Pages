import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { registerLogSecret } from "@/backend/logging/LogRedaction";
import {
  runnerMessageSchema,
  runnerPlanBindingSchema,
} from "@/definition/RunnerProtocol";
import { runnerExecutionSchema } from "@/definition/RunnerExecution";
import { applyRunnerMessage } from "./RunnerProtocol";
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
} from "@/definition/RunnerProtocol";

interface RegistrationGrant {
  readonly digest: string;
  readonly userId: string;
  readonly revision: number;
  readonly expiresAt: number;
}

/** Credential returned once, over the authenticated runner channel only. */
export interface RunnerAuthentication {
  readonly connectionId: string;
  readonly runnerId: string;
  readonly token: string | null;
  readonly sessionId: string;
}

const GRANT_MILLISECONDS = 120_000;
const HEARTBEAT_MILLISECONDS = 45_000;

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A connected, checked connection that has stayed up for five seconds. */
function isStableConnection(connection: RemoteConnectionView): boolean {
  return (
    connection.session.status === "connected" &&
    connection.hostKey !== null &&
    !connection.isChecking &&
    connection.lastCheck?.code === null &&
    Date.now() - Date.parse(connection.session.connectedAt ?? "") >= 5000
  );
}

function matches(token: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(digest(token), "hex"),
    Buffer.from(expected, "hex"),
  );
}

/** Authorizes short-lived pairing and maintains durable sessions independently of SSH transports. */
export class RunnerService {
  private readonly repository: RunnerRepository;
  private readonly events: RunnerPlanEventService | undefined;
  private readonly connections: RemoteConnectionService;
  private readonly grants = new Map<string, RegistrationGrant>();
  private readonly heartbeats = new Map<string, number>();
  private readonly writes = new SerialQueue();
  private readonly channels = new Map<string, (reply: RunnerReply) => void>();
  private readonly interpreters = new Map<
    string,
    readonly RunnerInterpreter[]
  >();
  private readonly tools = new Map<string, readonly ToolInventory[]>();
  private readonly cliExecutors = new Set<string>();
  private readonly githubProbes = new Set<string>();

  public constructor(
    repository: RunnerRepository,
    connections: RemoteConnectionService,
    events?: RunnerPlanEventService,
  ) {
    this.repository = repository;
    this.events = events;
    this.connections = connections;
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
    return this.writes.run(async () => {
      const record = await this.repository.find(connectionId);
      if (!record) throw new Error("Runner registration missing");
      await this.requireRevision(record);
      const replay = await this.events?.replay(
        connectionId,
        record.state,
        message,
      );
      if (replay) {
        this.heartbeats.set(connectionId, Date.now());
        return replay;
      }
      const result = applyRunnerMessage(record.state, message);
      if (result.state !== record.state)
        await this.repository.checkpoint(
          connectionId,
          result.state,
          (transaction) =>
            this.events?.apply(transaction, connectionId, {
              previous: record.state,
              state: result.state,
              message,
            }) ?? Promise.resolve(),
        );
      this.heartbeats.set(connectionId, Date.now());
      if (message.type === "reconcile") {
        if (message.githubAccessVersion === 1)
          this.githubProbes.add(connectionId);
        else this.githubProbes.delete(connectionId);
        if (message.cliExecutorVersion === 1)
          this.cliExecutors.add(connectionId);
        else this.cliExecutors.delete(connectionId);
        if (message.executorVersion === 1)
          this.interpreters.set(connectionId, message.interpreters ?? []);
        else this.interpreters.delete(connectionId);
        if (message.tools) this.tools.set(connectionId, message.tools);
        else this.tools.delete(connectionId);
      }
      return result.reply;
    });
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
      if (record.state.jobs.length >= 1000)
        throw new Error("Runner queue unavailable");
      const job: RunnerJob = {
        ...(binding ? { plan: binding } : {}),
        ...(execution ? { execution } : {}),
        jobId: randomUUID(),
        sessionId: record.state.sessionId,
        status: "queued",
      };
      await this.repository.checkpoint(connectionId, {
        ...record.state,
        jobs: [...record.state.jobs, job],
      });
      this.deliver(connectionId, { version: 1, type: "dispatch", job });
      return job;
    });
  }

  /** Drops live status after a closed or expired socket. */
  public disconnected(connectionId: string): void {
    this.heartbeats.delete(connectionId);
    this.interpreters.delete(connectionId);
    this.tools.delete(connectionId);
    this.cliExecutors.delete(connectionId);
    this.githubProbes.delete(connectionId);
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
    const isOnline =
      Date.now() - (this.heartbeats.get(connectionId) ?? 0) <
      HEARTBEAT_MILLISECONDS;
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
    return () => {
      if (this.channels.get(connectionId) === send)
        this.channels.delete(connectionId);
    };
  }

  /** Drops the current execution sender after its socket closes. */
  public detach(connectionId: string): void {
    this.channels.delete(connectionId);
  }

  /** Requires an executing runner, rather than a transport-only bootstrap. */
  public async ready(
    userId: string,
    connectionId: string,
  ): Promise<readonly RunnerInterpreter[]> {
    await this.requireOnline(userId, connectionId);
    const interpreters = this.interpreters.get(connectionId);
    if (!interpreters) throw new Error("Runner executor unavailable");
    return interpreters;
  }

  /** Reports the probe capability explicitly; older runners never receive an unknown command. */
  public supportsGitHubAccess(connectionId: string): boolean {
    return this.githubProbes.has(connectionId);
  }

  /** Returns CLI facts only from a runner that implements CLI execution. */
  public async cliInventory(
    userId: string,
    connectionId: string,
  ): Promise<readonly ToolInventory[]> {
    await this.ready(userId, connectionId);
    return this.cliExecutors.has(connectionId)
      ? (this.tools.get(connectionId) ?? [])
      : [];
  }

  /** Distinguishes invalid pairing from a disconnected or outdated executor. */
  public async availability(
    connectionId: string,
  ): Promise<"remoteIdentity" | "remoteOffline" | null> {
    const status = await this.status(connectionId);
    if (!status.isPaired) return "remoteIdentity";
    return status.isReady ? null : "remoteOffline";
  }

  /** Cancellation is explicit and targets the original durable claim only. */
  public cancel(connectionId: string, jobId: string): void {
    this.deliver(connectionId, { version: 1, type: "cancel", jobId });
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
    const runner =
      record?.connectionRevision === connection.revision ? record : null;
    return {
      connectionId: connection.id,
      name: connection.name,
      endpoint: `${connection.username}@${connection.host}:${connection.port}`,
      departmentName: connection.departmentName,
      checkedAt: connection.lastCheck?.checkedAt ?? null,
      isStable: isStableConnection(connection),
      runnerId: record?.runnerId ?? null,
      needsPairing: record !== null && runner === null,
      isOnline:
        runner !== null &&
        Date.now() - (this.heartbeats.get(connection.id) ?? 0) <
          HEARTBEAT_MILLISECONDS,
      tools: runner ? (this.tools.get(connection.id) ?? null) : null,
    };
  }

  private async requireRevision(record: RunnerRecord): Promise<void> {
    const scope = await this.connections.scopeForRunner(record.connectionId);
    if (scope !== record.connectionRevision)
      throw new Error("Runner connection revoked or changed");
  }
}
