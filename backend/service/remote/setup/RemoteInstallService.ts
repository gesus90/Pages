import { logCaughtError } from "@/backend/logging/Logger";

import { probeCommand, parseProbeOutput } from "./RemoteInstallProbe";
import { bindingOf, installViewOf, isSameBinding } from "./RemoteInstallView";

import type { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import type { RemoteConnectionRepository } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type {
  InstallBinding,
  RemoteInstallView,
} from "@/definition/RemoteSetup";
import type { RunnerLiveStatus } from "./RemoteInstallView";

/** What identifies the machine of a connection; a finding is believed only while it holds. */
type ConnectionIdentity = Pick<
  RemoteConnectionView,
  "id" | "host" | "port" | "username" | "hostKey"
>;

const PROBE_TIMEOUT = 20_000;
const EMPTY_STATUS: RunnerLiveStatus = { isPaired: false, isReady: false };

/** What only the runner services know; they are built after the remote services. */
export interface RemoteInstallLinks {
  /** Pages' own view of the runner of a connection. */
  readonly runnerStatus: (connectionId: string) => Promise<RunnerLiveStatus>;
  /** Whether a setup run holds the connection right now. */
  readonly isSetupRunning: (connectionId: string) => boolean;
}

/**
 * Observes what is installed on each connected machine and keeps the latest finding.
 *
 * @remarks
 * After every successful SSH connect a read-only probe records the finding,
 * bound to host, port, user and pinned host key. A finding that no longer
 * matches the connection is ignored, so changing the connection invalidates
 * it. The probe never starts or installs anything.
 */
export class RemoteInstallService {
  private readonly findings: RemoteInstallFindingRepository;
  private readonly connections: Pick<RemoteConnectionRepository, "find">;
  private readonly sessions: RemoteSessionRegistry;
  private readonly inspections = new Map<string, Promise<void>>();
  private links: RemoteInstallLinks | null = null;

  public constructor(dependencies: {
    readonly findings: RemoteInstallFindingRepository;
    readonly connections: Pick<RemoteConnectionRepository, "find">;
    readonly sessions: RemoteSessionRegistry;
  }) {
    this.findings = dependencies.findings;
    this.connections = dependencies.connections;
    this.sessions = dependencies.sessions;
  }

  /** Connects the parts that exist only after the runner services are built. */
  public attach(links: RemoteInstallLinks): void {
    this.links = links;
  }

  /**
   * Probes the machine after a connect without letting a failure reach the caller.
   *
   * @param connectionId - The connection that just connected.
   */
  public inspectAfterConnect(connectionId: string): void {
    void this.inspect(connectionId).catch((error: unknown) =>
      logCaughtError("RemoteInstallService", error),
    );
  }

  /**
   * Runs the probe over the connection and stores the finding.
   *
   * @remarks
   * Concurrent calls for one connection share a single probe. A result is
   * dropped when the connection's identity changed while the probe ran.
   *
   * @param connectionId - The connection.
   * @returns Settles when the finding is stored.
   */
  public inspect(connectionId: string): Promise<void> {
    const running = this.inspections.get(connectionId);
    if (running) return running;
    const inspection = this.runProbe(connectionId).finally(() =>
      this.inspections.delete(connectionId),
    );
    this.inspections.set(connectionId, inspection);
    return inspection;
  }

  /**
   * The installation view of each given connection.
   *
   * @param connections - Connections the caller may manage.
   * @returns The view by connection identifier.
   */
  public async views(
    connections: readonly ConnectionIdentity[],
  ): Promise<Readonly<Record<string, RemoteInstallView>>> {
    const entries = await Promise.all(
      connections.map(
        async (connection) =>
          [connection.id, await this.view(connection)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  /**
   * The installation view of one stored connection.
   *
   * @param connectionId - The connection.
   * @returns The view; `unknown` when the connection does not exist.
   */
  public async current(connectionId: string): Promise<RemoteInstallView> {
    const record = await this.connections.find(connectionId);
    if (!record)
      return installViewOf({
        finding: null,
        live: EMPTY_STATUS,
        isRunning: false,
      });
    return this.view(record);
  }

  private async view(
    connection: ConnectionIdentity,
  ): Promise<RemoteInstallView> {
    const binding = bindingOf({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      hostKeyFingerprint: connection.hostKey?.fingerprint ?? null,
    });
    const [stored, live] = await Promise.all([
      this.findings.find(connection.id),
      this.links?.runnerStatus(connection.id) ?? EMPTY_STATUS,
    ]);
    const isValid =
      stored !== null &&
      binding !== null &&
      isSameBinding(stored.binding, binding);
    return installViewOf({
      finding: isValid ? stored : null,
      live,
      isRunning: this.links?.isSetupRunning(connection.id) ?? false,
    });
  }

  private async currentBinding(
    connectionId: string,
  ): Promise<InstallBinding | null> {
    const record = await this.connections.find(connectionId);
    if (!record) return null;
    return bindingOf({
      host: record.host,
      port: record.port,
      username: record.username,
      hostKeyFingerprint: record.hostKey?.fingerprint ?? null,
    });
  }

  private async runProbe(connectionId: string): Promise<void> {
    const binding = await this.currentBinding(connectionId);
    if (binding === null) return;
    const result = await this.sessions
      .session(connectionId)
      .run(probeCommand(), PROBE_TIMEOUT);
    if (result.exitCode !== 0) throw new Error("Install probe failed");
    const observation = parseProbeOutput(result.stdout);
    const current = await this.currentBinding(connectionId);
    if (current === null || !isSameBinding(binding, current)) return;
    await this.findings.save(connectionId, {
      binding: current,
      observedAt: new Date().toISOString(),
      observation,
    });
  }
}
