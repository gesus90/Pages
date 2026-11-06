import { createHash, randomBytes } from "node:crypto";

/** What a bridge bearer stands for, held only in the memory of the API process. */
export interface PlanBridgeGrant {
  readonly runId: string;
  /** The step, or the group a retained session serves. */
  readonly stepId: string;
  /** The process instance of the session; members of a group share it. */
  readonly instanceId: string;
  /** The credential of the step; the service authorization behind the bearer. */
  readonly token: string;
  /** Epoch milliseconds after which the grant no longer admits a call; zero means until revocation. */
  readonly expiresAt: number;
}

/**
 * Tells from the stored run whether the session of a grant is working on a
 * running step right now.
 */
export type PlanSessionActivity = (grant: PlanBridgeGrant) => Promise<boolean>;

function digest(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/**
 * The bearers of the plan bridge, owned by the API process.
 *
 * @remarks
 * A bearer is a random token that exists only in this object and in the
 * session of its step. It stands for the step credential, which Pages keeps
 * as a hash for the upload and attachment checks. Nothing in the database lets
 * a bearer survive the memory of this process: after an API restart every
 * bearer is unknown and refused.
 *
 * A grant ends in these ways, each of which fails closed:
 * - `revoke`, when the step closes, is cancelled, fails or is recovered;
 * - the stored run: a call is admitted only while the run runs and a step of
 *   the grant's session is `running`, read anew for every call, so a missed
 *   revocation (for example a failed call from an engine in another process)
 *   cannot keep a finished step's bearer usable while other steps of the run
 *   continue;
 * - the expiry of a grant with a finite lifetime;
 * - the end of this process.
 */
export class PlanBridgeGrants {
  private readonly grants = new Map<string, PlanBridgeGrant>();
  private readonly isActive: PlanSessionActivity;

  /**
   * Creates the registry of this API process.
   *
   * @param isActive - Reads the stored run and tells whether the grant's session has a running step.
   */
  public constructor(isActive: PlanSessionActivity) {
    this.isActive = isActive;
  }

  /**
   * Opens the bearer of one step.
   *
   * @param grant - The step and its credential.
   * @returns The bearer, to be handed to the session of that step only.
   */
  public open(grant: PlanBridgeGrant): string {
    const bearer = randomBytes(32).toString("base64url");
    this.grants.set(digest(bearer), grant);
    return bearer;
  }

  /**
   * Resolves a presented bearer to the credential of its active step.
   *
   * @param bearer - The bearer of a request.
   * @returns The step credential, or `null` for an unknown, ended, expired or inactive grant.
   */
  public async resolve(bearer: string): Promise<string | null> {
    const key = digest(bearer);
    const grant = this.grants.get(key);
    if (!grant) return null;
    if (grant.expiresAt !== 0 && grant.expiresAt <= Date.now()) {
      this.grants.delete(key);
      return null;
    }
    const isActive = await this.isActive(grant);
    // A revocation during the read wins: the grant must still be the registered one.
    if (this.grants.get(key) !== grant) return null;
    if (isActive) return grant.token;
    this.grants.delete(key);
    return null;
  }

  /**
   * Ends the bearers of one step, or of every step of a run.
   *
   * @param runId - The run.
   * @param stepId - The step or group, or `null` for the whole run.
   * @returns How many bearers ended.
   */
  public revoke(runId: string, stepId: string | null): number {
    let ended = 0;
    for (const [key, grant] of this.grants) {
      if (grant.runId !== runId) continue;
      if (stepId !== null && grant.stepId !== stepId) continue;
      this.grants.delete(key);
      ended += 1;
    }
    return ended;
  }
}
