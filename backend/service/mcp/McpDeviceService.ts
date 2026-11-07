import { McpDeviceError } from "@/backend/error/McpDeviceError";
import {
  hashMcpDeviceValue,
  isMcpDeviceCredential,
} from "@/backend/security/McpDeviceCredential";
import { MCP_DEVICE_API_VERSION } from "@/definition/McpDevice";

import type { McpDeviceRepository } from "@/backend/database/repositories/mcp/McpDeviceRepository";
import type { McpDeviceView } from "@/definition/McpDevice";

/** The machine and the account a valid token stands for. */
export interface McpDeviceIdentity {
  readonly apiVersion: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly pairedAt: number;
  readonly account: {
    readonly displayName: string;
    readonly username: string;
  };
}

/** Reads the token of an `Authorization: Bearer` header. */
function readBearerToken(header: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/iu.exec(header ?? "");
  const token = match?.[1];
  return isMcpDeviceCredential(token) ? token : null;
}

/**
 * Serves the paired machines: token checks, self-service unpairing and the list of an account.
 *
 * @remarks
 * A token acts with the rights of its account, checked on every request: a
 * revoked machine, a deactivated or a deleted account makes it `invalid_token`.
 * Every successful check notes the time of use.
 */
export class McpDeviceService {
  private readonly repository: McpDeviceRepository;
  private readonly now: () => number;

  /**
   * Creates the service.
   *
   * @param repository - Storage of the paired machines.
   * @param now - The clock in Unix milliseconds.
   */
  public constructor(
    repository: McpDeviceRepository,
    now: () => number = Date.now,
  ) {
    this.repository = repository;
    this.now = now;
  }

  /**
   * Checks a token and notes its use.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The machine and its account.
   * @throws {McpDeviceError} `invalid_token` with `401` for a missing, unknown or revoked token.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpDeviceIdentity> {
    const token = readBearerToken(authorization);
    if (token === null) throw new McpDeviceError("invalid_token", 401);
    const device = await this.repository.touchByTokenHash(
      hashMcpDeviceValue("token", token),
      this.now(),
    );
    if (device === null) throw new McpDeviceError("invalid_token", 401);
    return {
      apiVersion: MCP_DEVICE_API_VERSION,
      deviceId: device.id,
      deviceName: device.name,
      pairedAt: device.pairedAt,
      account: { displayName: device.displayName, username: device.username },
    };
  }

  /**
   * Lets a machine end its own pairing.
   *
   * @param authorization - The `Authorization` header of the request.
   * @throws {McpDeviceError} `invalid_token` with `401` when the token is not valid.
   */
  public async unpair(authorization: string | null): Promise<void> {
    await this.authenticate(authorization);
    const token = readBearerToken(authorization);
    if (
      token === null ||
      !(await this.repository.revokeByTokenHash(
        hashMcpDeviceValue("token", token),
        this.now(),
      ))
    )
      throw new McpDeviceError("invalid_token", 401);
  }

  /**
   * Lists the active machines of an account.
   *
   * @param userId - The account.
   * @returns The machines for the connections page; no hash and no token.
   */
  public async list(userId: string): Promise<readonly McpDeviceView[]> {
    const devices = await this.repository.listForUser(userId);
    return devices.map((device) => ({
      id: device.id,
      name: device.name,
      clientVersion: device.clientVersion,
      pairedAt: new Date(device.pairedAt).toISOString(),
      lastUsedAt:
        device.lastUsedAt === null
          ? null
          : new Date(device.lastUsedAt).toISOString(),
    }));
  }

  /**
   * Revokes one machine of an account; its token fails on the next request.
   *
   * @param userId - The signed-in account.
   * @param deviceId - The machine to revoke.
   * @returns Whether a machine of this account was revoked.
   */
  public async revoke(userId: string, deviceId: string): Promise<boolean> {
    return this.repository.revokeForUser(deviceId, userId, this.now());
  }
}
