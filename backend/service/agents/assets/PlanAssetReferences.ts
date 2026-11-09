import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { PlanAssetService } from "./PlanAssetService";

/** How long a runner may redeem a reference after Pages issued it. */
const REFERENCE_LIFETIME_MS = 5 * 60_000;

/** What a reference grants: one file, for one person, in one node of one run. */
interface ReferenceGrant {
  readonly assetId: string;
  readonly userId: string;
  readonly digest: string;
  readonly runId: string;
  readonly stepId: string;
  readonly expiresAt: number;
  readonly nonce: string;
}

/** The file a redeemed reference hands to a runner. */
export interface RedeemedPlanAsset {
  readonly assetId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
}

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function isGrant(input: unknown): input is ReferenceGrant {
  if (typeof input !== "object" || input === null) return false;
  const fields = ["assetId", "userId", "digest", "runId", "stepId", "nonce"];
  return (
    fields.every((field) => typeof Reflect.get(input, field) === "string") &&
    typeof Reflect.get(input, "expiresAt") === "number"
  );
}

/**
 * Signed, short-lived references through which a runner reaches a plan asset.
 *
 * @remarks
 * A runner, local or remote, never sees a path of Pages: it gets a reference
 * and redeems it. Redeeming checks the signature and the lifetime and then
 * reads the file with the rights of the person the run belongs to, so a
 * reference outliving a revoked right gives nothing, and a reference never
 * names another file than the one it was issued for. `isDenied` lets the
 * simulation's `runner_denied` scenario refuse every reference.
 */
export class PlanAssetReferences {
  private readonly assets: Pick<PlanAssetService, "read" | "describe">;
  private readonly key: Buffer;
  private readonly isDenied: boolean;

  public constructor(
    assets: Pick<PlanAssetService, "read" | "describe">,
    secret: Buffer,
    options: { readonly isDenied?: boolean } = {},
  ) {
    this.assets = assets;
    this.key = createHmac("sha256", secret)
      .update("pages-plan-asset-reference-v1")
      .digest();
    this.isDenied = options.isDenied === true;
  }

  /**
   * Issues a reference after checking that the person may read the file now.
   *
   * @throws {AgentError} `plan_asset_missing` when the person may not read it.
   */
  public async issue(
    userId: string,
    input: {
      readonly assetId: string;
      readonly digest: string;
      readonly runId: string;
      readonly stepId: string;
    },
  ): Promise<string> {
    await this.assets.describe(userId, input.assetId);
    const grant: ReferenceGrant = {
      ...input,
      userId,
      expiresAt: Date.now() + REFERENCE_LIFETIME_MS,
      nonce: randomUUID(),
    };
    const payload = encode(JSON.stringify(grant));
    return `${payload}.${this.sign(payload)}`;
  }

  /**
   * Hands the file of a valid reference to a runner.
   *
   * @throws {AgentError} `plan_asset_runner_denied` for a forged, expired or
   * refused reference and when the person lost the right to the file;
   * `plan_asset_changed` when the content is no longer the one referenced.
   */
  public async redeem(reference: string): Promise<RedeemedPlanAsset> {
    const grant = this.verify(reference);
    let bytes: Buffer;
    let fileName: string;
    let mediaType: string;
    try {
      const record = await this.assets.describe(grant.userId, grant.assetId);
      bytes = await this.assets.read(grant.userId, grant.assetId);
      fileName = record.fileName;
      mediaType = record.mediaType;
      if (record.digest !== grant.digest)
        throw new AgentError("plan_asset_changed");
    } catch (error: unknown) {
      logCaughtError("PlanAssetReferences", error);
      if (error instanceof AgentError && error.code !== "plan_asset_missing")
        throw error;
      throw new AgentError("plan_asset_runner_denied");
    }
    return { assetId: grant.assetId, fileName, mediaType, bytes };
  }

  private verify(reference: string): ReferenceGrant {
    const [payload = "", signature = ""] = reference.split(".");
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (
      this.isDenied ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      throw new AgentError("plan_asset_runner_denied");
    let grant: unknown;
    try {
      grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch (error: unknown) {
      logCaughtError("PlanAssetReferences", error);
      throw new AgentError("plan_asset_runner_denied");
    }
    if (!isGrant(grant) || grant.expiresAt < Date.now())
      throw new AgentError("plan_asset_runner_denied");
    return grant;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.key).update(payload).digest("base64url");
  }
}
