import { randomInt, randomUUID } from "node:crypto";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";

import { PairingRateError, PairingThrottle } from "./PairingThrottle";
import {
  normalizePairingCode,
  pairingText,
  pairingValidity,
} from "./PairingValidation";

import type {
  PairingRepository,
  StoredPairingRequest,
} from "@/backend/database/repositories/mcp/PairingRepository";
import type { AgentIdentityService } from "./AgentIdentityService";
import type { PairingAddress } from "./PairingThrottle";
import type {
  McpPairedCredential,
  McpPairingView,
  PairingBrowserIdentity,
} from "@/definition/McpPairing";
import type { PersonalAgentToken } from "@/definition/McpAuthorization";

const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** Explicit approval, session-bound forms and exactly-once device credential issuance. */
export class PairingService {
  private readonly repository: PairingRepository;
  private readonly identities: AgentIdentityService;
  private readonly throttle = new PairingThrottle();

  public constructor(
    repository: PairingRepository,
    identities: AgentIdentityService,
  ) {
    this.repository = repository;
    this.identities = identities;
  }

  /** Creates a ten-minute request without consulting browser cookies. */
  public async begin(
    input: Readonly<Record<string, unknown>>,
    address: PairingAddress,
  ): Promise<{
    apiVersion: "1";
    service: "pages";
    userCode: string;
    deviceSecret: string;
    expiresAt: number;
    interval: 5;
  }> {
    this.throttle.request(address);
    const clientName = pairingText(input.clientName);
    const device = pairingText(input.device);
    const packageVersion = pairingText(input.packageVersion, 32);
    const deviceSecret = createAgentCredential();
    const createdAt = Date.now();
    const expiresAt = createdAt + 600_000;
    const id = randomUUID();
    const code = await this.repository.transaction(async (repository) => {
      if ((await repository.maintain(createdAt)) >= 500)
        throw new PairingRateError(600);
      const userCode = await this.newCode(repository);
      await repository.insert({
        id,
        codeHash: hashAgentCredential(userCode),
        secretHash: hashAgentCredential(deviceSecret),
        clientName,
        device,
        packageVersion,
        createdAt,
        expiresAt,
        status: "pending",
        userId: null,
        decidedAt: null,
        name: null,
        validitySeconds: null,
        csrfHash: null,
        lastPollAt: null,
        pollInterval: 5,
      });
      return `${userCode.slice(0, 4)}-${userCode.slice(4)}`;
    });
    this.throttle.started(id, address, expiresAt);
    return {
      apiVersion: "1",
      service: "pages",
      userCode: code,
      deviceSecret,
      expiresAt,
      interval: 5,
    };
  }

  /** Returns only client labels, public account facts and a session-bound nonce. */
  public async view(
    input: unknown,
    browser: PairingBrowserIdentity,
    address: PairingAddress,
  ): Promise<McpPairingView> {
    const identity = await this.identities.verify(browser.userId);
    this.throttle.browser(browser.userId, address);
    return this.repository.transaction(async (repository) => {
      const account = await this.requireAccount(repository, browser.userId);
      const publicAccount = {
        displayName: account.displayName,
        username: account.username,
        isAdmin: identity.isAdmin,
      };
      if (input === null || input === undefined)
        return { status: "entry", code: "", account: publicAccount };
      const code = normalizePairingCode(input);
      const request = code
        ? await repository.find(hashAgentCredential(code))
        : null;
      const invalid: McpPairingView = {
        status: "invalid",
        code: "",
        account: publicAccount,
      };
      if (
        !request ||
        (request.status !== "pending" && request.userId !== browser.userId)
      ) {
        this.throttle.browser(browser.userId, address, true);
        return invalid;
      }
      if (
        request.expiresAt <= Date.now() &&
        (request.status === "pending" || request.status === "approved")
      ) {
        await repository.complete(request.id, "expired");
        return request.userId === browser.userId
          ? { ...invalid, status: "expired" }
          : invalid;
      }
      if (request.status !== "pending")
        return {
          status: request.status,
          code,
          account: publicAccount,
          expiresAt: request.expiresAt,
        };
      // Revalidation must not invalidate a form while the user compares its code.
      const csrf = hashAgentCredential(
        `pairing:${browser.session}:${request.id}`,
      );
      await repository.bind(
        request.id,
        this.nonceHash(browser, csrf),
        browser.userId,
      );
      return {
        status: "pending",
        code: `${code.slice(0, 4)}-${code.slice(4)}`,
        csrf,
        clientName: request.clientName,
        device: request.device,
        packageVersion: request.packageVersion,
        requestedAt: request.createdAt,
        expiresAt: request.expiresAt,
        validityDays: await repository.preferences().get(browser.userId),
        account: publicAccount,
      };
    });
  }

  /** Stores a single explicit decision; approval never creates or returns a token. */
  public async decide(
    input: Readonly<Record<string, unknown>>,
    browser: PairingBrowserIdentity,
  ): Promise<void> {
    await this.identities.verify(browser.userId);
    const code = normalizePairingCode(input.code);
    if (
      !code ||
      typeof input.csrf !== "string" ||
      (input.decision !== "approve" && input.decision !== "deny")
    )
      throw new McpAuthorizationError("invalid_request");
    const csrf = input.csrf;
    const approved = input.decision === "approve";
    if (approved && input.confirmMatch !== true)
      throw new McpAuthorizationError("confirm_match_required");
    const name = approved ? pairingText(input.name) : null;
    const days = approved ? pairingValidity(input.validityDays) : 0;
    await this.repository.transaction(async (repository) => {
      await this.requireAccount(repository, browser.userId);
      const request = await repository.find(hashAgentCredential(code));
      if (
        !request ||
        request.status !== "pending" ||
        request.expiresAt <= Date.now()
      )
        throw new McpAuthorizationError("invalid_grant");
      if (request.csrfHash !== this.nonceHash(browser, csrf))
        throw new McpAuthorizationError("access_denied", 403);
      const now = Date.now();
      await repository.decide({
        ...request,
        userId: browser.userId,
        status: approved ? "approved" : "denied",
        decidedAt: now,
        name,
        validitySeconds: days === 0 ? null : days * 86_400,
        expiresAt: approved
          ? Math.max(request.expiresAt, now + 60_000)
          : request.expiresAt,
      });
      if (approved)
        this.throttle.approved(
          request.id,
          Math.max(request.expiresAt, now + 60_000),
        );
      else this.throttle.ended(request.id);
    });
  }

  /** Issues a token once to the device that holds the original secret, atomically. */
  public async exchange(
    input: Readonly<Record<string, unknown>>,
  ): Promise<McpPairedCredential> {
    const result = await this.repository.transaction(async (repository) => {
      const request = await this.deviceRequest(repository, input);
      if (request.status === "consumed") return { error: "invalid_grant" };
      if (request.status === "denied") return { error: "access_denied" };
      if (
        request.status === "cancelled" ||
        request.status === "expired" ||
        request.expiresAt <= Date.now()
      ) {
        await repository.complete(request.id, "expired");
        return { error: "expired_token" };
      }
      const now = Date.now();
      const isEarly =
        (request.lastPollAt ?? request.createdAt) +
          request.pollInterval * 1000 >
        now;
      await repository.poll(
        request.id,
        now,
        request.pollInterval + (isEarly ? 5 : 0),
      );
      if (isEarly) return { error: "slow_down" };
      if (request.status === "pending")
        return { error: "authorization_pending" };
      return this.issue(repository, request);
    });
    if ("error" in result) throw new McpAuthorizationError(result.error);
    return result;
  }

  /** Cancels without creating or revoking an already collected credential. */
  public async cancel(
    input: Readonly<Record<string, unknown>>,
  ): Promise<{ cancelled: true }> {
    await this.repository.transaction(async (repository) => {
      const request = await this.deviceRequest(repository, input);
      await repository.complete(request.id, "cancelled");
      this.throttle.ended(request.id);
    });
    return { cancelled: true };
  }

  /** Reads the personal validity preference. */
  public async validity(userId: string): Promise<number> {
    await this.identities.verify(userId);
    return this.repository.preferences().get(userId);
  }

  /** Applies a personal validity change without reviving ended credentials. */
  public async setValidity(userId: string, input: unknown): Promise<void> {
    const days = pairingValidity(input);
    await this.identities.verify(userId);
    await this.repository.transaction((repository) =>
      repository.preferences().set(userId, days, Date.now()),
    );
  }

  private async newCode(repository: PairingRepository): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from(
        { length: 8 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join("");
      if (!(await repository.find(hashAgentCredential(code)))) return code;
    }
    throw new McpAuthorizationError("temporarily_unavailable", 503);
  }

  private nonceHash(browser: PairingBrowserIdentity, csrf: string): string {
    return hashAgentCredential(`${browser.session}:${browser.userId}:${csrf}`);
  }

  private async deviceRequest(
    repository: PairingRepository,
    input: Readonly<Record<string, unknown>>,
  ): Promise<StoredPairingRequest> {
    const code = normalizePairingCode(input.userCode);
    if (
      !code ||
      typeof input.deviceSecret !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.deviceSecret)
    )
      throw new McpAuthorizationError("invalid_grant");
    const request = await repository.find(hashAgentCredential(code));
    if (
      !request ||
      request.secretHash !== hashAgentCredential(input.deviceSecret)
    )
      throw new McpAuthorizationError("invalid_grant");
    return request;
  }

  private async requireAccount(
    repository: PairingRepository,
    userId: string,
  ): Promise<{ displayName: string; username: string }> {
    const account = await repository.account(userId);
    if (!account?.isEligible)
      throw new McpAuthorizationError("invalid_token", 401);
    return { displayName: account.displayName, username: account.username };
  }

  private async issue(
    repository: PairingRepository,
    request: StoredPairingRequest,
  ): Promise<McpPairedCredential> {
    if (!request.userId || !request.name)
      throw new McpAuthorizationError("invalid_grant");
    const account = await this.requireAccount(repository, request.userId);
    const token = createAgentCredential();
    const createdAt = Date.now();
    const summary: PersonalAgentToken = {
      id: randomUUID(),
      userId: request.userId,
      name: request.name,
      source: "pairing",
      device: request.device,
      createdAt,
      expiresAt:
        request.validitySeconds === null
          ? null
          : createdAt + request.validitySeconds * 1000,
      revokedAt: null,
      lastUsedAt: null,
      rotatedAt: null,
      rotationRequestedAt: null,
      status: "active",
    };
    await repository.tokens().insert(summary, hashAgentCredential(token));
    await repository.complete(request.id, "consumed", summary.id);
    this.throttle.ended(request.id);
    return {
      token,
      tokenId: summary.id,
      name: summary.name,
      expiresAt: summary.expiresAt,
      account,
    };
  }
}
