import type {
  InstallBinding,
  InstallComponents,
  InstallFinding,
  InstallState,
  RemoteInstallView,
} from "@/definition/RemoteSetup";

/** What Pages itself knows about the runner of a connection, independent of the machine. */
export interface RunnerLiveStatus {
  readonly isPaired: boolean;
  readonly isReady: boolean;
}

/** The identity a finding must still match to be believed. */
export interface InstallIdentity {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly hostKeyFingerprint: string | null;
}

/**
 * The binding of a connection as findings store it.
 *
 * @param identity - Host, port, user and the pinned key's fingerprint.
 * @returns The binding, or `null` while no host key is pinned.
 */
export function bindingOf(identity: InstallIdentity): InstallBinding | null {
  if (identity.hostKeyFingerprint === null) return null;
  return {
    host: identity.host.toLowerCase(),
    port: identity.port,
    username: identity.username,
    hostKeyFingerprint: identity.hostKeyFingerprint,
  };
}

/** Whether two bindings name the same machine, account and pinned key. */
export function isSameBinding(
  left: InstallBinding,
  right: InstallBinding,
): boolean {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.username === right.username &&
    left.hostKeyFingerprint === right.hostKeyFingerprint
  );
}

/**
 * Whether the installation is confirmed: the runner is on the machine and
 * registered with its service manager, the service runs and starts at boot,
 * and Pages holds its pairing.
 *
 * @param components - The separate facts.
 * @returns Whether every one of them holds; being ready right now is not required.
 */
export function isInstallConfirmed(components: InstallComponents): boolean {
  return (
    components.isInstalled &&
    components.isActive &&
    components.isAutostart &&
    components.isPaired
  );
}

function stateOf(input: {
  readonly finding: InstallFinding;
  readonly components: InstallComponents;
}): InstallState {
  const { observation } = input.finding;
  const { components } = input;
  if (isInstallConfirmed(components)) return "confirmed";
  const hasAnything =
    observation.isRunnerInstalled ||
    observation.isServiceInstalled ||
    components.isActive ||
    components.isAutostart ||
    components.isPaired;
  return hasAnything ? "partial" : "not_installed";
}

/**
 * Builds the view of a connection's installation.
 *
 * @remarks
 * `confirmed` needs the runner code registered with the machine's service
 * manager, a running and enabled service, and a registration of Pages itself.
 * A machine without a service manager registers nothing, so it can never be
 * confirmed. A finding that is missing or no longer matches the connection
 * leaves the state `unknown`.
 *
 * @param input - The valid finding or `null`, Pages' runner status, and whether a setup runs now.
 * @returns The view.
 */
export function installViewOf(input: {
  readonly finding: InstallFinding | null;
  readonly live: RunnerLiveStatus;
  readonly isRunning: boolean;
}): RemoteInstallView {
  const { finding, live } = input;
  if (finding === null)
    return {
      state: input.isRunning ? "running" : "unknown",
      serviceManager: null,
      components: null,
      runnerVersion: null,
      observedAt: null,
      tools: [],
    };
  const { observation } = finding;
  const components: InstallComponents = {
    isInstalled:
      observation.isRunnerInstalled &&
      (observation.serviceManager === "none" || observation.isServiceInstalled),
    isServiceQueryable: observation.canQueryService,
    isActive: observation.isServiceActive,
    isAutostart: observation.isServiceEnabled,
    isPaired: live.isPaired,
    isReady: live.isReady,
  };
  return {
    state: input.isRunning ? "running" : stateOf({ finding, components }),
    serviceManager: observation.serviceManager,
    components,
    runnerVersion: observation.runnerVersion,
    observedAt: finding.observedAt,
    tools: observation.tools,
  };
}
