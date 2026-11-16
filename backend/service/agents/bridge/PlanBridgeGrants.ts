import { randomBytes } from "node:crypto";

import { hashAgentCredential } from "@/backend/security/AgentCredential";

import {
  openPlanBridgeToken,
  planBridgeBearerHash,
  sealPlanBridgeToken,
} from "./PlanBridgeGrantSeal";

import type { PlanBridgeGrantRepository } from "@/backend/database/repositories/agent/PlanBridgeGrantRepository";

/** What a bridge bearer stands for. */
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

/** Where the grants are kept so that they outlive the API process. */
export type PlanBridgeGrantStore = Pick<
  PlanBridgeGrantRepository,
  "insert" | "find" | "delete" | "revoke"
>;

/**
 * The bearers of the plan bridge, owned by the API process.
 * @remarks
 * A bearer is a random token that only the session of its step holds. It
 * stands for the step credential, which Pages keeps as a hash for the upload
 * and attachment checks. The registry caches its grants in memory and stores
 * each one so that a session, which runs in its own unit, keeps working after
 * a restart of the API process. The stored row holds neither the bearer nor a
 * usable credential: it is found by the SHA-256 of the bearer, and the
 * credential is sealed with a key only the bearer yields
 * ({@link sealPlanBridgeToken}). After a restart the first call of a session
 * opens its row and passes the same checks as before.
 * A grant ends in these ways, each of which fails closed:
 * - `revoke`, when the step closes, is cancelled, fails or is recovered;
 * - the stored run: a call is admitted only while the run runs and a step of
 *   the grant's session is `running`, read anew for every call, so a missed
 *   revocation (for example a failed call from an engine in another process)
 *   cannot keep a finished step's bearer usable while other steps of the run
 *   continue;
 * - the expiry of a grant with a finite lifetime;
 * - the revocation or deletion of the step credential, which the bridge
 *   checks for every call and with which the stored grant goes.
 */
export class PlanBridgeGrants {
  private readonly grants = new Map<string, PlanBridgeGrant>();
  private readonly isActive: PlanSessionActivity;
  private readonly store: PlanBridgeGrantStore;
  private revocations = 0;

  /**
   * Creates the registry of this API process.
   * @param isActive - Reads the stored run and tells whether the grant's session has a running step.
   * @param store - Keeps the grants across a restart of this process.
   */
  public constructor(
    isActive: PlanSessionActivity,
    store: PlanBridgeGrantStore,
  ) {
    this.isActive = isActive;
    this.store = store;
  }

  /**
   * Opens the bearer of one step.
   * @param grant - The step and its credential.
   * @returns The bearer, to be handed to the session of that step only.
   */
  public async open(grant: PlanBridgeGrant): Promise<string> {
    const bearer = randomBytes(32).toString("base64url");
    const key = planBridgeBearerHash(bearer);
    await this.store.insert(
      {
        bearerHash: key,
        credentialHash: hashAgentCredential(grant.token),
        runId: grant.runId,
        stepId: grant.stepId,
        instanceId: grant.instanceId,
        sealedToken: sealPlanBridgeToken(bearer, grant.token, grant),
        expiresAt: grant.expiresAt,
      },
      Date.now(),
    );
    this.grants.set(key, grant);
    return bearer;
  }

  /**
   * Resolves a presented bearer to the credential of its active step.
   * @param bearer - The bearer of a request.
   * @returns The step credential, or `null` for an unknown, ended, expired or inactive grant.
   */
  public async resolve(bearer: string): Promise<string | null> {
    const key = planBridgeBearerHash(bearer);
    const grant = this.grants.get(key) ?? (await this.restore(key, bearer));
    if (!grant) return null;
    if (grant.expiresAt !== 0 && grant.expiresAt <= Date.now()) {
      await this.forget(key);
      return null;
    }
    const isActive = await this.isActive(grant);
    // A revocation during the read wins: the grant must still be the registered one.
    if (this.grants.get(key) !== grant) return null;
    if (isActive) return grant.token;
    await this.forget(key);
    return null;
  }

  /**
   * Ends the bearers of one step, or of every step of a run.
   * @param runId - The run.
   * @param stepId - The step or group, or `null` for the whole run.
   * @returns How many bearers of this process ended.
   */
  public async revoke(runId: string, stepId: string | null): Promise<number> {
    let ended = 0;
    for (const [key, grant] of this.grants) {
      if (grant.runId !== runId) continue;
      if (stepId !== null && grant.stepId !== stepId) continue;
      this.grants.delete(key);
      ended += 1;
    }
    this.revocations += 1;
    await this.store.revoke(runId, stepId);
    return ended;
  }

  /** Opens the stored grant of a bearer this process has not seen, as after a restart. */
  private async restore(
    key: string,
    bearer: string,
  ): Promise<PlanBridgeGrant | null> {
    const revocations = this.revocations;
    const stored = await this.store.find(key);
    if (!stored) return null;
    const token = openPlanBridgeToken(bearer, stored.sealedToken, stored);
    if (token === null) return null;
    // A revocation during the read may have removed the row just read; only a row that is still stored counts.
    if (this.revocations !== revocations && !(await this.store.find(key)))
      return null;
    // A concurrent call of the same session may have restored it already.
    const known = this.grants.get(key);
    if (known) return known;
    const grant: PlanBridgeGrant = {
      runId: stored.runId,
      stepId: stored.stepId,
      instanceId: stored.instanceId,
      token,
      expiresAt: stored.expiresAt,
    };
    this.grants.set(key, grant);
    return grant;
  }

  private async forget(key: string): Promise<void> {
    this.grants.delete(key);
    await this.store.delete(key);
  }
}
