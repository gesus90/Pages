import { setTimeout as delay } from "node:timers/promises";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { consoleMessageOf } from "../RemoteConsoleSession";
import { isInstallConfirmed } from "./RemoteInstallView";
import { SetupMarkerFilter } from "./SetupMarkerFilter";
import {
  applyMarker,
  failedProgress,
  finishedProgress,
  preparationStep,
  startedProgress,
} from "./SetupProgressModel";
import { SetupReasonError, pairingEndpoint } from "./SetupPairing";

import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RunnerSetupService } from "@/backend/service/runner/RunnerSetupService";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type {
  RemoteInstallView,
  SetupPreparationStep,
  SetupProgress,
} from "@/definition/RemoteSetup";
import type {
  ConductorControl,
  ConductorExit,
  RemoteConsoleConductor,
} from "../RemoteConsoleConductor";
import type { RemoteConnectionService } from "../RemoteConnectionService";
import type { RemoteInstallService } from "./RemoteInstallService";
import type { SetupMarker } from "./SetupMarkerFilter";

/** The script ends with this status when the person stops before the service is registered. */
export const SETUP_EXIT_STOPPED = 10;

/** An SSH session counts as stable after this long, as everywhere else in the runner setup. */
const STABLE_MILLISECONDS = 5000;
const CONFIRM_TIMEOUT = 60_000;
const CONFIRM_INTERVAL = 3000;
const REASON_PREFIX = "remote.setup.reason.";

/** Everything one setup run needs; the service builds it per console. */
export interface SetupConductorDependencies {
  readonly userId: string;
  readonly connectionId: string;
  /** The SSH host of the connection, to tell a loopback Pages address from one the machine can reach. */
  readonly sshHost: string;
  readonly pagesAddress: {
    readonly origin: string | null;
    readonly publicUrl: string | null;
  };
  readonly connections: Pick<RemoteConnectionService, "requireSetup">;
  readonly runners: Pick<
    RunnerService,
    "authorize" | "requireSetup" | "status"
  >;
  readonly delivery: Pick<
    RunnerSetupService,
    "transfer" | "verify" | "makeExecutable" | "launchCommand"
  >;
  readonly sessions: Pick<RemoteSessionRegistry, "session" | "view">;
  readonly install: Pick<RemoteInstallService, "inspect" | "current">;
  /** The conditions of a start, checked again right before anything is written. */
  readonly requireStart: () => Promise<void>;
}

/** The translation key that names why a step failed; native error text never reaches the browser. */
function reasonOf(error: unknown): string {
  if (error instanceof SetupReasonError)
    return `${REASON_PREFIX}${error.reason}`;
  if (error instanceof RemoteError) return consoleMessageOf(error);
  return "remote.error.remote_setup_failed";
}

/** The first fact that keeps a finished script from counting as an installation. */
function missingReason(view: RemoteInstallView | null): string {
  const components = view?.components ?? null;
  if (view === null || components === null)
    return `${REASON_PREFIX}notObserved`;
  if (!components.isInstalled) return `${REASON_PREFIX}notInstalled`;
  if (view.serviceManager === "none") return `${REASON_PREFIX}noServiceManager`;
  if (!components.isServiceQueryable)
    return `${REASON_PREFIX}serviceNotQueryable`;
  if (!components.isActive || !components.isAutostart)
    return `${REASON_PREFIX}serviceNotRunning`;
  if (!components.isPaired) return `${REASON_PREFIX}notPaired`;
  return `${REASON_PREFIX}notReady`;
}

/**
 * Runs the guided runner setup inside a console: prepares the machine, starts
 * the script, follows its phases, hands over the pairing and verifies the result.
 *
 * @remarks
 * The script only reports progress. Pages decides the outcome itself: a run
 * is confirmed only when the probe finds the runner, an active and enabled
 * service, and Pages holds the pairing and sees the runner online.
 */
export class RemoteSetupConductor implements RemoteConsoleConductor {
  public readonly command: string;
  private readonly dependencies: SetupConductorDependencies;
  private readonly markers = new SetupMarkerFilter();
  private progress: SetupProgress = startedProgress();
  private isStarted = false;
  private hasOutput = false;
  private isPairingHandled = false;
  private pairingReason: string | null = null;

  public constructor(dependencies: SetupConductorDependencies) {
    this.dependencies = dependencies;
    this.command = dependencies.delivery.launchCommand();
  }

  /** Whether the script was started; it is never started a second time. */
  public hasStarted(): boolean {
    return this.isStarted;
  }

  /** Checks rights and the connection, delivers and verifies the script; a failure stops everything after it. */
  public async prepare(control: ConductorControl): Promise<void> {
    const { userId, connectionId, delivery } = this.dependencies;
    this.progress = startedProgress();
    control.report(this.progress);
    await this.step(control, "rights", () => this.dependencies.requireStart());
    await this.step(control, "connection", () => this.stableConnection());
    await this.step(control, "upload", () =>
      delivery.transfer(userId, connectionId),
    );
    await this.step(control, "verification", () =>
      delivery.verify(userId, connectionId),
    );
    await this.step(control, "permissions", () =>
      delivery.makeExecutable(userId, connectionId),
    );
    this.progress = preparationStep(this.progress, "console");
    control.report(this.progress);
  }

  /** The console is open and the script is about to run. */
  public terminalOpened(control: ConductorControl): void {
    this.isStarted = true;
    this.progress = preparationStep(this.progress, "start");
    control.report(this.progress);
  }

  /** Follows the script's phase reports and hands the pairing over when it asks. */
  public filter(chunk: string, control: ConductorControl): string {
    const { text, markers } = this.markers.feed(chunk);
    const isFirst = !this.hasOutput && (text !== "" || markers.length > 0);
    if (isFirst) {
      this.hasOutput = true;
      this.progress = preparationStep(this.progress, null);
    }
    for (const marker of markers) this.accept(marker, control);
    if (isFirst || markers.length > 0) control.report(this.progress);
    return text;
  }

  /** Decides the outcome after the script ended; only Pages' own checks can confirm. */
  public async finish(
    exit: ConductorExit,
    control: ConductorControl,
  ): Promise<void> {
    if (exit.isTransportFailure) {
      this.progress = failedProgress(this.progress, {
        reason: "remote.failure.transport_lost",
      });
      control.report(this.progress);
      return;
    }
    if (exit.exitCode === 0) {
      this.progress = await this.verifiedProgress();
    } else {
      await this.refreshFinding();
      this.progress = this.endedProgress(exit.exitCode);
    }
    control.report(this.progress);
  }

  /** A failure before or outside the terminal fails the current phase and its preparation step. */
  public abort(error: unknown, control: ConductorControl): void {
    this.progress = failedProgress(this.progress, { reason: reasonOf(error) });
    control.report(this.progress);
  }

  private async step(
    control: ConductorControl,
    step: SetupPreparationStep,
    work: () => Promise<unknown>,
  ): Promise<void> {
    this.progress = preparationStep(this.progress, step);
    control.report(this.progress);
    await work();
  }

  /** Opens the session when it is idle and waits until it has been stable for five seconds. */
  private async stableConnection(): Promise<void> {
    const { sessions, runners, userId, connectionId } = this.dependencies;
    await sessions.session(connectionId).run("true", 15_000);
    const connectedAt = Date.parse(
      sessions.view(connectionId).connectedAt ?? "",
    );
    const remaining = connectedAt + STABLE_MILLISECONDS - Date.now();
    if (Number.isFinite(connectedAt) && remaining > 0) await delay(remaining);
    try {
      await runners.requireSetup(userId, connectionId);
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError("remote_setup_unstable");
    }
  }

  private accept(marker: SetupMarker, control: ConductorControl): void {
    const next = applyMarker(this.progress, marker);
    const isAccepted = next !== this.progress;
    this.progress = next;
    if (
      isAccepted &&
      marker.phase === 8 &&
      marker.state === "waiting" &&
      marker.step === "pairing"
    )
      void this.deliverPairing(control);
  }

  /**
   * Types the address and the one-time grant into the waiting script, once.
   *
   * @remarks
   * The script switched echo off before it asked, so the grant appears
   * neither in the terminal nor in the replay history. If Pages cannot
   * deliver, empty lines make the script give up at once.
   */
  private async deliverPairing(control: ConductorControl): Promise<void> {
    if (this.isPairingHandled) return;
    this.isPairingHandled = true;
    const { userId, connectionId, connections, runners } = this.dependencies;
    try {
      await connections.requireSetup(userId, connectionId);
      const endpoint = pairingEndpoint({
        ...this.dependencies.pagesAddress,
        connectionId,
        sshHost: this.dependencies.sshHost,
      });
      const { grant } = await runners.authorize(userId, connectionId);
      control.write(`${endpoint}\n${grant}\n`);
    } catch (error: unknown) {
      logCaughtError("RemoteSetupConductor", error);
      this.pairingReason = reasonOf(error);
      control.write("\n\n");
    }
  }

  private endedProgress(exitCode: number): SetupProgress {
    if (exitCode === SETUP_EXIT_STOPPED)
      return finishedProgress(this.progress, {
        outcome: "partial",
        reason: `${REASON_PREFIX}stopped`,
      });
    return failedProgress(this.progress, {
      reason: this.pairingReason ?? `${REASON_PREFIX}scriptFailed`,
    });
  }

  /** Waits for the probe and the runner's first heartbeats; the script's own exit status proves neither. */
  private async verifiedProgress(): Promise<SetupProgress> {
    const { runners, install, connectionId } = this.dependencies;
    const deadline = Date.now() + CONFIRM_TIMEOUT;
    let view: RemoteInstallView | null = null;
    while (true) {
      await this.refreshFinding();
      view = await install.current(connectionId);
      const isReady = (await runners.status(connectionId)).isReady;
      if (view.components && isInstallConfirmed(view.components) && isReady)
        return finishedProgress(this.progress, {
          outcome: "confirmed",
          reason: null,
        });
      if (Date.now() >= deadline) break;
      await delay(CONFIRM_INTERVAL);
    }
    return failedProgress(this.progress, {
      reason: missingReason(view),
      outcome: "partial",
    });
  }

  private async refreshFinding(): Promise<void> {
    try {
      await this.dependencies.install.inspect(this.dependencies.connectionId);
    } catch (error: unknown) {
      logCaughtError("RemoteSetupConductor", error);
    }
  }
}
