import { AgentError } from "@/backend/error/AgentErrors";
import { logDiagnostic } from "@/backend/logging/Logger";

import type { ClaudePlanSessionHome } from "./ClaudePlanSessionHome";
import type { CliSessionRequest } from "./CliContracts";
import type { CliPlanIsolation } from "./CliPlanIsolation";

/** A session request, wrapped in the namespace where bubblewrap works. */
export interface IsolatedRequest {
  readonly request: CliSessionRequest;
  readonly isIsolated: boolean;
}

/**
 * Decides whether a session runs inside the mount namespace and which home it gets there.
 *
 * @remarks
 * Where bubblewrap does not work, the session starts as before and one
 * warning says so, unless the operator demanded isolation: then the node
 * fails before any process.
 */
export class CliIsolationGate {
  private readonly isolation: CliPlanIsolation | null;
  private readonly isRequired: boolean;
  private hasWarned = false;

  public constructor(isolation: CliPlanIsolation | null, isRequired: boolean) {
    this.isolation = isolation;
    this.isRequired = isRequired;
  }

  /**
   * Gives a Claude plan session its private transcript home inside the namespace.
   *
   * @param request - The session as it would start with the connection's own home.
   * @param scoped - The plan's transcript home, or `null` for any other session.
   *
   * @remarks
   * Without a namespace nothing separates the homes: the session then keeps
   * the connection's own home, which holds the login, instead of an empty one.
   */
  public async isolateSession(
    request: CliSessionRequest,
    scoped: ClaudePlanSessionHome | null,
  ): Promise<IsolatedRequest> {
    if (scoped === null) return this.isolate(request);
    const isolated = await this.isolate({
      ...request,
      home: scoped.home,
      credentialFile: scoped.credential,
    });
    return isolated.isIsolated ? isolated : this.isolate(request);
  }

  private async isolate(request: CliSessionRequest): Promise<IsolatedRequest> {
    if (this.isolation === null) {
      if (this.isRequired) throw new AgentError("cli_isolation_unavailable");
      return { request, isIsolated: false };
    }
    const isolated = await this.isolation.isolate(request);
    if (isolated !== null) return { request: isolated, isIsolated: true };
    if (this.isRequired) throw new AgentError("cli_isolation_unavailable");
    if (!this.hasWarned) {
      this.hasWarned = true;
      logDiagnostic(
        "CliSessionExecution",
        "warn",
        "Pages runs CLI agents without a mount namespace because bubblewrap does not work on this host. Install it, or set PAGES_CLI_ISOLATION=required to refuse such runs.",
      );
    }
    return { request, isIsolated: false };
  }
}
