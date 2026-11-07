import { randomUUID } from "node:crypto";

import { McpDeviceError } from "@/backend/error/McpDeviceError";
import { createAgentCredential } from "@/backend/security/AgentCredential";
import {
  createUserCode,
  equalMcpDeviceHashes,
  hashMcpDeviceValue,
  isMcpDeviceCredential,
} from "@/backend/security/McpDeviceCredential";
import {
  formatUserCode,
  MCP_CLIENT_VERSION_LIMIT,
  MCP_DEVICE_API_VERSION,
  MCP_DEVICE_NAME_LIMIT,
  MCP_PAIRING_INTERVAL_SECONDS,
  MCP_PAIRING_LIFETIME_MS,
  normalizeUserCode,
} from "@/definition/McpDevice";

import type {
  McpDevicePairingRepository,
  McpPairingLimits,
  StoredMcpPairing,
} from "@/backend/database/repositories/mcp/McpDevicePairingRepository";
import type { McpPairingState } from "@/definition/McpDevice";

/** Starts per minute and open requests an address may have. */
const PAIRING_LIMITS: McpPairingLimits = {
  startsPerWindow: 10,
  windowMs: 60_000,
  openRequests: 20,
};

/** Draws of a user code before a start gives up; a clash is already rare. */
const CODE_ATTEMPTS = 5;

/** Control characters are never part of a machine name or a version. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** What a client needs to show the code and to ask for the result. */
export interface StartedMcpPairing {
  readonly apiVersion: string;
  readonly userCode: string;
  readonly deviceSecret: string;
  readonly verificationUrl: string;
  readonly expiresAt: number;
  readonly interval: number;
}

/** The token of a confirmed pairing, handed out once. */
export interface CollectedMcpToken {
  readonly apiVersion: string;
  readonly token: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly account: {
    readonly displayName: string;
    readonly username: string;
  };
}

/** What the page shows about one code for one account. */
export interface McpPairingInspection {
  readonly state: McpPairingState;
  /** The code as displayed (`XXXX-XXXX`); `null` without a readable code. */
  readonly code: string | null;
  readonly deviceName: string | null;
  readonly expiresAt: number | null;
}

/** Where a start comes from and what it asks for; all fields are untrusted. */
export interface McpPairingStart {
  readonly device: unknown;
  readonly clientVersion: unknown;
  /** The address of the requester as the server knows it. */
  readonly address: string;
  /** Origin of the instance, as the requester reached it. */
  readonly origin: string;
}

/** A client's proof for one pairing request; all fields are untrusted. */
export interface McpPairingProof {
  readonly userCode: unknown;
  readonly deviceSecret: unknown;
}

function readBoundedText(value: unknown, limit: number): string {
  if (typeof value !== "string") throw new McpDeviceError("invalid_request");
  const text = value.trim();
  if (text.length < 1 || text.length > limit || CONTROL_CHARACTER.test(text))
    throw new McpDeviceError("invalid_request");
  return text;
}

/**
 * Runs the pairing of a machine with an account: start, confirmation in the browser and token handover.
 *
 * @remarks
 * User code, device secret and token are stored as hashes only. A pairing
 * request belongs to exactly one device secret, and a wrong secret answers
 * like an unknown code. The token is issued by the one statement that claims
 * a confirmed request, so it is handed out once.
 */
export class McpDevicePairingService {
  private readonly repository: McpDevicePairingRepository;
  private readonly now: () => number;

  /**
   * Creates the service.
   *
   * @param repository - Storage of the requests and of the machines created from them.
   * @param now - The clock in Unix milliseconds.
   */
  public constructor(
    repository: McpDevicePairingRepository,
    now: () => number = Date.now,
  ) {
    this.repository = repository;
    this.now = now;
  }

  /**
   * Starts a pairing request for a machine.
   *
   * @param input - The machine name and client version, the requester address and the instance origin.
   * @returns The code to show, the secret to keep and the link to open.
   * @throws {McpDeviceError} `invalid_request` for a bad body, `slow_down` with `429` over a limit.
   */
  public async start(input: McpPairingStart): Promise<StartedMcpPairing> {
    const deviceName = readBoundedText(input.device, MCP_DEVICE_NAME_LIMIT);
    const clientVersion = readBoundedText(
      input.clientVersion,
      MCP_CLIENT_VERSION_LIMIT,
    );
    const createdAt = this.now();
    const expiresAt = createdAt + MCP_PAIRING_LIFETIME_MS;
    const deviceSecret = createAgentCredential();
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const userCode = createUserCode();
      const outcome = await this.repository.insertWithinLimits(
        {
          id: randomUUID(),
          userCodeHash: hashMcpDeviceValue("user-code", userCode),
          deviceSecretHash: hashMcpDeviceValue("device-secret", deviceSecret),
          deviceName,
          clientVersion,
          addressHash: hashMcpDeviceValue("address", input.address),
          createdAt,
          expiresAt,
        },
        PAIRING_LIMITS,
      );
      if (outcome.kind === "limited")
        throw new McpDeviceError(
          "slow_down",
          429,
          Math.max(1, Math.ceil(outcome.retryAfterMs / 1000)),
        );
      if (outcome.kind === "stored")
        return {
          apiVersion: MCP_DEVICE_API_VERSION,
          userCode: formatUserCode(userCode),
          deviceSecret,
          verificationUrl: `${input.origin}/koppeln?code=${formatUserCode(userCode)}`,
          expiresAt,
          interval: MCP_PAIRING_INTERVAL_SECONDS,
        };
    }
    throw new McpDeviceError("temporarily_unavailable", 503);
  }

  /**
   * Answers a client's query for the result of its request.
   *
   * @param proof - The user code and the device secret of the start.
   * @returns The token, once, after the person confirmed the pairing.
   * @throws {McpDeviceError} With the code of the interface while no token can be issued.
   */
  public async collect(proof: McpPairingProof): Promise<CollectedMcpToken> {
    const pairing = await this.authenticate(proof);
    if (pairing.status === "collected")
      throw new McpDeviceError("invalid_grant");
    const now = this.now();
    if (
      !(await this.repository.notePoll(
        pairing.id,
        now,
        MCP_PAIRING_INTERVAL_SECONDS * 1000,
      ))
    )
      throw new McpDeviceError("slow_down");
    if (pairing.status === "denied") throw new McpDeviceError("access_denied");
    if (pairing.status === "cancelled" || pairing.expiresAt <= now)
      throw new McpDeviceError("expired_token");
    if (pairing.status === "pending")
      throw new McpDeviceError("authorization_pending");
    return this.issueToken(pairing, now);
  }

  /**
   * Ends a request on behalf of the client that started it.
   *
   * @param proof - The user code and the device secret of the start.
   * @throws {McpDeviceError} `invalid_grant` for an unknown code, a wrong secret or a collected request.
   */
  public async cancel(proof: McpPairingProof): Promise<void> {
    const pairing = await this.authenticate(proof);
    if (pairing.status === "collected")
      throw new McpDeviceError("invalid_grant");
    await this.repository.cancel(pairing.id);
  }

  /**
   * Tells what the page shows for a code.
   *
   * @param code - The code from the address, untrusted.
   * @param userId - The signed-in account.
   * @returns The state; a decision is shown only to the account that took it.
   */
  public async inspect(
    code: unknown,
    userId: string,
  ): Promise<McpPairingInspection> {
    const userCode = normalizeUserCode(code);
    if (userCode === null)
      return {
        state: code === null || code === "" ? "missing" : "invalid",
        code: null,
        deviceName: null,
        expiresAt: null,
      };
    const pairing = await this.repository.findByCodeHash(
      hashMcpDeviceValue("user-code", userCode),
    );
    const shown = formatUserCode(userCode);
    return {
      code: shown,
      ...this.describe(pairing, userId),
    };
  }

  /**
   * Records the decision of a person and tells what the page shows afterwards.
   *
   * @param input - The code, the deciding account and the decision.
   * @returns The state after the decision; a code that was decided before keeps its first decision.
   */
  public async decide(input: {
    readonly code: unknown;
    readonly userId: string;
    readonly decision: "approved" | "denied";
  }): Promise<McpPairingInspection> {
    const userCode = normalizeUserCode(input.code);
    const pairing =
      userCode === null
        ? null
        : await this.repository.findByCodeHash(
            hashMcpDeviceValue("user-code", userCode),
          );
    if (pairing !== null)
      await this.repository.decide({
        id: pairing.id,
        userId: input.userId,
        status: input.decision,
        now: this.now(),
      });
    return this.inspect(input.code, input.userId);
  }

  private describe(
    pairing: StoredMcpPairing | null,
    userId: string,
  ): Omit<McpPairingInspection, "code"> {
    const hidden = { deviceName: null, expiresAt: null };
    if (pairing === null) return { state: "invalid", ...hidden };
    if (pairing.status === "cancelled") return { state: "expired", ...hidden };
    if (pairing.status === "pending") {
      return pairing.expiresAt <= this.now()
        ? { state: "expired", ...hidden }
        : {
            state: "open",
            deviceName: pairing.deviceName,
            expiresAt: pairing.expiresAt,
          };
    }
    // A decision is private to the account that took it.
    if (pairing.userId !== userId) return { state: "invalid", ...hidden };
    return {
      state: pairing.status === "denied" ? "denied" : "paired",
      deviceName: pairing.deviceName,
      expiresAt: null,
    };
  }

  private async authenticate(
    proof: McpPairingProof,
  ): Promise<StoredMcpPairing> {
    const userCode = normalizeUserCode(proof.userCode);
    if (userCode === null || !isMcpDeviceCredential(proof.deviceSecret))
      throw new McpDeviceError("invalid_grant");
    const pairing = await this.repository.findByCodeHash(
      hashMcpDeviceValue("user-code", userCode),
    );
    if (
      pairing === null ||
      !equalMcpDeviceHashes(
        pairing.deviceSecretHash,
        hashMcpDeviceValue("device-secret", proof.deviceSecret),
      )
    )
      throw new McpDeviceError("invalid_grant");
    return pairing;
  }

  private async issueToken(
    pairing: StoredMcpPairing,
    now: number,
  ): Promise<CollectedMcpToken> {
    const token = createAgentCredential();
    const collected = await this.repository.collect(
      pairing.id,
      {
        deviceId: randomUUID(),
        tokenHash: hashMcpDeviceValue("token", token),
        pairedAt: now,
      },
      now,
    );
    // Another query claimed the request first, or its account is gone.
    if (collected === null) throw new McpDeviceError("invalid_grant");
    return {
      apiVersion: MCP_DEVICE_API_VERSION,
      token,
      deviceId: collected.deviceId,
      deviceName: collected.deviceName,
      account: {
        displayName: collected.displayName,
        username: collected.username,
      },
    };
  }
}
