import { expect, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { PairingService } from "@/backend/service/mcp/PairingService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import { ROLE } from "@/definition/Role";

import { accountFixture } from "../../auth/account-fixture";
import {
  MemoryPairingRepository,
  MemoryPairingStore,
  MemoryTokenRepository,
} from "./pairing-memory-store";

import type { PairingAddress } from "@/backend/service/mcp/PairingThrottle";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  McpPairedCredential,
  PairingBrowserIdentity,
} from "@/definition/McpPairing";
import type { User } from "@/definition/User";

/** The synthetic instant every pairing test starts at. */
export const CLOCK_START = Date.parse("2026-03-01T12:00:00Z");

/** What the device sends to start a pairing. */
export const DEVICE_INPUT = {
  clientName: "Synthetic Client",
  device: "Workstation Alpha",
  packageVersion: "1.4.2",
} as const;

/** Account facts a test can change per user. */
export interface UserFacts {
  isActive?: boolean;
  mustChangePassword?: boolean;
  isAdmin?: boolean;
}

/** What the device holds after the first request. */
export interface StartedPairing {
  readonly userCode: string;
  readonly deviceSecret: string;
  readonly expiresAt: number;
}

/** Freezes the clock at the start instant. */
export function startClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CLOCK_START);
}

/** Moves the frozen clock forward. */
export function advanceClock(milliseconds: number): void {
  vi.setSystemTime(Date.now() + milliseconds);
}

/** Builds the address of a request. */
export function addressOf(
  socket = "10.0.0.1",
  forwarded: string | null = null,
): PairingAddress {
  return { forwarded, socket };
}

/** Builds the browser identity of a signed-in session. */
export function browserOf(
  userId: string,
  session = "session-one",
): PairingBrowserIdentity {
  return { session, userId };
}

/** Removes the readability dash of a displayed code. */
export function rawCode(userCode: string): string {
  return userCode.replace("-", "");
}

/** Expects a promise to reject with the public authorization failure. */
export async function expectRejection(
  work: Promise<unknown>,
  code: string,
  status = 400,
): Promise<void> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(McpAuthorizationError);
  expect(error).toMatchObject({ code, status });
}

/** Returns what a synchronous call throws, or `null`. */
export function thrownBy(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }

  return null;
}

/**
 * The pairing and credential services on in-memory persistence.
 *
 * @remarks
 * Identity and account rows follow the facts of `addUser`, so a test can
 * deactivate an account between two steps.
 */
export class PairingWorld {
  /** Persistence behind both services. */
  public readonly store = new MemoryPairingStore();
  /** Pairing under test. */
  public readonly pairing: PairingService;
  /** Credential management under test. */
  public readonly tokens: PersonalAgentTokenService;
  private readonly facts = new Map<string, Required<UserFacts>>();

  public constructor() {
    const identities = new AgentIdentityService(
      { getById: async (userId) => this.userOf(userId) },
      { getContext: async (userId) => this.accessOf(userId) },
    );

    this.pairing = new PairingService(
      new MemoryPairingRepository(this.store),
      identities,
    );
    this.tokens = new PersonalAgentTokenService(
      new MemoryTokenRepository(this.store),
      identities,
    );
  }

  /** Registers an account; by default it is active and an employee. */
  public addUser(userId: string, facts: UserFacts = {}): void {
    this.facts.set(userId, {
      isActive: facts.isActive ?? true,
      isAdmin: facts.isAdmin ?? false,
      mustChangePassword: facts.mustChangePassword ?? false,
    });
    this.store.accounts.set(userId, {
      displayName: `Name of ${userId}`,
      isEligible:
        (facts.isActive ?? true) && !(facts.mustChangePassword ?? false),
      username: userId,
    });
  }

  /** Changes the facts of a registered account. */
  public changeUser(userId: string, facts: UserFacts): void {
    const current = this.facts.get(userId);

    this.addUser(userId, { ...current, ...facts });
  }

  /** Starts a pairing from a device. */
  public async start(
    address: PairingAddress = addressOf(),
  ): Promise<StartedPairing> {
    const started = await this.pairing.begin(DEVICE_INPUT, address);

    return {
      deviceSecret: started.deviceSecret,
      expiresAt: started.expiresAt,
      userCode: started.userCode,
    };
  }

  /** Lets a browser open the form and returns its confirmation value. */
  public async openForm(
    started: StartedPairing,
    browser: PairingBrowserIdentity,
  ): Promise<string> {
    const view = await this.pairing.view(
      started.userCode,
      browser,
      addressOf("192.168.0.9"),
    );

    expect(view.status).toBe("pending");
    expect(view.csrf).toEqual(expect.any(String));

    return view.csrf ?? "";
  }

  /** Approves a started pairing in the browser of the given user. */
  public async approve(
    started: StartedPairing,
    userId: string,
    validityDays = 30,
  ): Promise<void> {
    const browser = browserOf(userId);
    const csrf = await this.openForm(started, browser);

    await this.pairing.decide(
      {
        code: started.userCode,
        confirmMatch: true,
        csrf,
        decision: "approve",
        name: "Work laptop",
        validityDays,
      },
      browser,
    );
  }

  /** The device input that asks for the credential of a started pairing. */
  public deviceInput(started: StartedPairing): {
    userCode: string;
    deviceSecret: string;
  } {
    return {
      deviceSecret: started.deviceSecret,
      userCode: started.userCode,
    };
  }

  /** Runs a complete pairing and returns what the device received. */
  public async pairDevice(
    userId: string,
    validityDays = 30,
  ): Promise<McpPairedCredential> {
    const started = await this.start();

    await this.approve(started, userId, validityDays);
    advanceClock(5_000);

    return this.pairing.exchange(this.deviceInput(started));
  }

  private userOf(userId: string): User | null {
    const facts = this.facts.get(userId);

    if (facts === undefined) {
      return null;
    }

    return {
      displayName: `Name of ${userId}`,
      id: userId,
      isActive: facts.isActive,
      mustChangePassword: facts.mustChangePassword,
      role: facts.isAdmin ? ROLE.ADMIN : ROLE.EMPLOYEE,
      username: userId,
    };
  }

  private accessOf(userId: string): AccountAccess {
    const facts = this.facts.get(userId);

    return accountFixture({
      isActive: facts?.isActive ?? false,
      isAdmin: facts?.isAdmin ?? false,
      userId,
    });
  }
}
