import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscordError } from "@/backend/error/DiscordErrors";

import {
  ATTEMPT_LIFETIME_MS,
  DISCORD_CALLBACK_PATH,
  DiscordAuthorizationService,
  hashDiscordState,
} from "./DiscordAuthorizationService";

import type { DiscordAttemptRecord } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import type { DiscordFailure } from "@/backend/discord/DiscordApiClient";
import type { DiscordCallbackInput } from "./DiscordAuthorizationService";

const mocks = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => ({
  logDiagnostic: mocks.logDiagnostic,
}));

const NOW = new Date("2026-05-01T10:00:00.000Z");
const FUTURE = "2026-05-01T10:10:00.000Z";
const PAST = "2026-05-01T09:00:00.000Z";

afterEach(() => {
  vi.clearAllMocks();
});

function record(
  overrides: Partial<DiscordAttemptRecord> = {},
): DiscordAttemptRecord {
  return {
    baseUrl: "https://pages.example",
    consumedAt: null,
    createdAt: PAST,
    expiresAt: FUTURE,
    failure: null,
    guildId: null,
    guildName: null,
    id: "a1",
    projectId: "p1",
    stateHash: "hash",
    status: "pending",
    userId: "u1",
    ...overrides,
  };
}

function failure(problem: DiscordFailure["problem"]): {
  readonly ok: false;
  readonly failure: DiscordFailure;
} {
  return {
    failure: { problem, retryAfterSeconds: null, status: 401 },
    ok: false,
  };
}

function createService(
  withRuntime = true,
  withClock = true,
): {
  readonly service: DiscordAuthorizationService;
  readonly attempts: Record<string, ReturnType<typeof vi.fn>>;
  readonly exchangeAuthorizationCode: ReturnType<typeof vi.fn>;
  readonly getGuild: ReturnType<typeof vi.fn>;
} {
  const attempts = {
    cancel: vi.fn().mockResolvedValue(undefined),
    claimByStateHash: vi.fn(),
    confirm: vi.fn(),
    deleteExpired: vi.fn(),
    findAttempt: vi.fn(),
    findAttemptByStateHash: vi.fn(),
    findLatestAttempt: vi.fn(),
    insertAttempt: vi.fn().mockResolvedValue(undefined),
    recordAuthorization: vi.fn(),
    recordFailure: vi.fn().mockResolvedValue(true),
  };
  const exchangeAuthorizationCode = vi.fn();
  const getGuild = vi.fn();

  return {
    attempts,
    exchangeAuthorizationCode,
    getGuild,
    service: new DiscordAuthorizationService({
      attempts,
      now: withClock ? () => NOW : undefined,
      runtime: withRuntime
        ? {
            application: { applicationId: "app1" },
            client: { exchangeAuthorizationCode, getGuild },
          }
        : null,
    }),
  };
}

function callback(
  overrides: Partial<DiscordCallbackInput> = {},
): DiscordCallbackInput {
  return {
    code: "code",
    error: null,
    guildId: null,
    state: "state",
    ...overrides,
  };
}

describe("DiscordAuthorizationService.start", () => {
  it("stores the hash of a fresh state and returns the install link", async () => {
    const { service, attempts } = createService();

    const attempt = await service.start({
      baseUrl: "https://pages.example",
      projectId: "p1",
      userId: "u1",
    });
    const stored = attempts["insertAttempt"]?.mock.calls[0]?.[0] as {
      readonly stateHash: string;
      readonly expiresAt: string;
      readonly id: string;
    };
    const url = new URL(attempt.authorizeUrl ?? "");
    const state = url.searchParams.get("state") ?? "";

    expect(stored.stateHash).toBe(hashDiscordState(state));
    expect(stored.expiresAt).toBe(
      new Date(NOW.getTime() + ATTEMPT_LIFETIME_MS).toISOString(),
    );
    expect(url.searchParams.get("client_id")).toBe("app1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `https://pages.example${DISCORD_CALLBACK_PATH}`,
    );
    expect(attempt).toMatchObject({
      expiresAt: stored.expiresAt,
      failure: null,
      guild: null,
      id: stored.id,
      status: "pending",
    });
  });

  it("refuses without a Discord application", async () => {
    const { service } = createService(false);

    await expect(
      service.start({ baseUrl: "https://x", projectId: "p", userId: "u" }),
    ).rejects.toMatchObject({ code: "not_configured" });
  });

  it("uses the system clock by default", async () => {
    const { service } = createService(true, false);
    const attempt = await service.start({
      baseUrl: "https://x",
      projectId: "p",
      userId: "u",
    });

    expect(Number.isNaN(Date.parse(attempt.expiresAt))).toBe(false);
  });
});

describe("DiscordAuthorizationService.complete", () => {
  it("reports a missing application", async () => {
    const { service } = createService(false);

    expect(await service.complete(callback())).toBe("not_configured");
  });

  it("rejects a missing or oversized state", async () => {
    const { service, attempts } = createService();

    expect(await service.complete(callback({ state: null }))).toBe("invalid");
    expect(await service.complete(callback({ state: "" }))).toBe("invalid");
    expect(await service.complete(callback({ state: "x".repeat(201) }))).toBe(
      "invalid",
    );
    expect(attempts["claimByStateHash"]).not.toHaveBeenCalled();
  });

  it("claims the state by its hash", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(null);
    attempts["findAttemptByStateHash"]?.mockResolvedValue(null);
    await service.complete(callback());

    expect(attempts["claimByStateHash"]).toHaveBeenCalledWith(
      hashDiscordState("state"),
      NOW.toISOString(),
    );
  });

  it("explains an unknown state as invalid", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(null);
    attempts["findAttemptByStateHash"]?.mockResolvedValue(null);

    expect(await service.complete(callback())).toBe("invalid");
  });

  it("explains a used state", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(null);
    attempts["findAttemptByStateHash"]?.mockResolvedValue(
      record({ consumedAt: PAST }),
    );

    expect(await service.complete(callback())).toBe("used");
  });

  it("explains an expired state", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(null);
    attempts["findAttemptByStateHash"]?.mockResolvedValue(
      record({ expiresAt: PAST }),
    );

    expect(await service.complete(callback())).toBe("expired");
  });

  it("explains a cancelled but unexpired state as invalid", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(null);
    attempts["findAttemptByStateHash"]?.mockResolvedValue(
      record({ status: "cancelled" }),
    );

    expect(await service.complete(callback())).toBe("invalid");
  });
});

describe("DiscordAuthorizationService.complete (part 2)", () => {
  it("records a denied consent", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());

    expect(await service.complete(callback({ error: "access_denied" }))).toBe(
      "denied",
    );
    expect(attempts["recordFailure"]).toHaveBeenCalledWith("a1", "denied");
  });

  it("fails without an authorization code", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());

    expect(await service.complete(callback({ code: null }))).toBe("failed");
    expect(attempts["recordFailure"]).toHaveBeenCalledWith(
      "a1",
      "exchange_failed",
    );
  });

  it("reports invalid credentials once and fails the exchange", async () => {
    const { service, attempts, exchangeAuthorizationCode } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    exchangeAuthorizationCode.mockResolvedValue(failure("invalid_credentials"));

    expect(await service.complete(callback())).toBe("failed");
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      "code",
      `https://pages.example${DISCORD_CALLBACK_PATH}`,
    );
    expect(mocks.logDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("fails the exchange quietly for other problems", async () => {
    const { service, attempts, exchangeAuthorizationCode } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    exchangeAuthorizationCode.mockResolvedValue(failure("unavailable"));

    expect(await service.complete(callback())).toBe("failed");
    expect(mocks.logDiagnostic).not.toHaveBeenCalled();
  });

  it("fails when the token response names no server", async () => {
    const { service, attempts, exchangeAuthorizationCode } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    exchangeAuthorizationCode.mockResolvedValue({
      ok: true,
      value: { guildId: null },
    });

    expect(await service.complete(callback())).toBe("failed");
    expect(attempts["recordFailure"]).toHaveBeenCalledWith("a1", "no_guild");
  });

  it("fails when the address names another server", async () => {
    const { service, attempts, exchangeAuthorizationCode } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    exchangeAuthorizationCode.mockResolvedValue({
      ok: true,
      value: { guildId: "g1" },
    });

    expect(await service.complete(callback({ guildId: "g2" }))).toBe("failed");
    expect(attempts["recordFailure"]).toHaveBeenCalledWith(
      "a1",
      "verification_failed",
    );
  });
});

describe("DiscordAuthorizationService.complete (part 3)", () => {
  it("fails when the bot cannot read the server", async () => {
    const { service, attempts, exchangeAuthorizationCode, getGuild } =
      createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    exchangeAuthorizationCode.mockResolvedValue({
      ok: true,
      value: { guildId: "g1" },
    });
    getGuild.mockResolvedValue(failure("invalid_credentials"));

    expect(await service.complete(callback({ guildId: "g1" }))).toBe("failed");
    expect(getGuild).toHaveBeenCalledWith("g1");
    expect(mocks.logDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("fails when Discord returns another server", async () => {
    const { service, attempts, exchangeAuthorizationCode, getGuild } =
      createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    exchangeAuthorizationCode.mockResolvedValue({
      ok: true,
      value: { guildId: "g1" },
    });
    getGuild.mockResolvedValue({ ok: true, value: { id: "g9", name: "X" } });

    expect(await service.complete(callback())).toBe("failed");
  });

  it("authorizes a verified server", async () => {
    const { service, attempts, exchangeAuthorizationCode, getGuild } =
      createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    attempts["recordAuthorization"]?.mockResolvedValue(true);
    exchangeAuthorizationCode.mockResolvedValue({
      ok: true,
      value: { guildId: "g1" },
    });
    getGuild.mockResolvedValue({
      ok: true,
      value: { id: "g1", name: "Guild" },
    });

    expect(await service.complete(callback({ guildId: "g1" }))).toBe(
      "authorized",
    );
    expect(attempts["recordAuthorization"]).toHaveBeenCalledWith("a1", {
      id: "g1",
      name: "Guild",
    });
  });

  it("reports invalid when the attempt was cancelled meanwhile", async () => {
    const { service, attempts, exchangeAuthorizationCode, getGuild } =
      createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    attempts["recordAuthorization"]?.mockResolvedValue(false);
    exchangeAuthorizationCode.mockResolvedValue({
      ok: true,
      value: { guildId: "g1" },
    });
    getGuild.mockResolvedValue({
      ok: true,
      value: { id: "g1", name: "Guild" },
    });

    expect(await service.complete(callback())).toBe("invalid");
  });

  it("reports invalid when a failure can no longer be stored", async () => {
    const { service, attempts } = createService();

    attempts["claimByStateHash"]?.mockResolvedValue(record());
    attempts["recordFailure"]?.mockResolvedValue(false);

    expect(await service.complete(callback({ code: null }))).toBe("invalid");
  });
});

describe("DiscordAuthorizationService.findOwn", () => {
  it("returns null without an attempt", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValue(null);

    expect(await service.findOwn("u1", "p1")).toBeNull();
    expect(attempts["findLatestAttempt"]).toHaveBeenCalledWith("p1", "u1");
  });

  it("hides confirmed and cancelled attempts", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValueOnce(
      record({ status: "confirmed" }),
    );
    attempts["findLatestAttempt"]?.mockResolvedValueOnce(
      record({ status: "cancelled" }),
    );

    expect(await service.findOwn("u1", "p1")).toBeNull();
    expect(await service.findOwn("u1", "p1")).toBeNull();
  });

  it("hides an attempt long after its expiry", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValue(
      record({ expiresAt: "2026-05-01T08:00:00.000Z" }),
    );

    expect(await service.findOwn("u1", "p1")).toBeNull();
  });

  it("shows an open attempt", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValue(record());

    expect(await service.findOwn("u1", "p1")).toEqual({
      authorizeUrl: null,
      expiresAt: FUTURE,
      failure: null,
      guild: null,
      id: "a1",
      status: "pending",
    });
  });

  it("shows an authorized attempt with its server", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValue(
      record({ guildId: "g1", guildName: "Guild", status: "authorized" }),
    );

    expect(await service.findOwn("u1", "p1")).toMatchObject({
      guild: { id: "g1", name: "Guild" },
      status: "authorized",
    });
  });

  it("shows an expired open attempt as expired", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValue(
      record({ expiresAt: PAST }),
    );

    expect(await service.findOwn("u1", "p1")).toMatchObject({
      status: "expired",
    });
  });

  it("keeps the status of a failed attempt that expired", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValue(
      record({ expiresAt: PAST, failure: "denied", status: "failed" }),
    );

    expect(await service.findOwn("u1", "p1")).toMatchObject({
      failure: "denied",
      status: "failed",
    });
  });

  it("shows no server when only one of its fields is known", async () => {
    const { service, attempts } = createService();

    attempts["findLatestAttempt"]?.mockResolvedValueOnce(
      record({ guildId: "g1" }),
    );
    attempts["findLatestAttempt"]?.mockResolvedValueOnce(
      record({ guildName: "Guild" }),
    );

    expect((await service.findOwn("u1", "p1"))?.guild).toBeNull();
    expect((await service.findOwn("u1", "p1"))?.guild).toBeNull();
  });
});

describe("DiscordAuthorizationService.requireConfirmable", () => {
  const input = { attemptId: "a1", projectId: "p1", userId: "u1" };
  const authorized = record({
    guildId: "g1",
    guildName: "Guild",
    status: "authorized",
  });

  it("returns an authorized attempt of the user", async () => {
    const { service, attempts } = createService();

    attempts["findAttempt"]?.mockResolvedValue(authorized);

    expect(await service.requireConfirmable(input)).toEqual(authorized);
  });

  it.each([
    { found: null, label: "unknown" },
    { found: { ...authorized, userId: "u2" }, label: "foreign user" },
    { found: { ...authorized, projectId: "p2" }, label: "foreign project" },
    { found: { ...authorized, status: "pending" }, label: "not authorized" },
    { found: { ...authorized, guildId: null }, label: "without guild id" },
    { found: { ...authorized, guildName: null }, label: "without guild name" },
    { found: { ...authorized, expiresAt: PAST }, label: "expired" },
  ])("refuses an attempt that is $label", async ({ found }) => {
    const { service, attempts } = createService();

    attempts["findAttempt"]?.mockResolvedValue(found);

    await expect(service.requireConfirmable(input)).rejects.toBeInstanceOf(
      DiscordError,
    );
  });
});

describe("DiscordAuthorizationService.consume", () => {
  it("passes when the attempt was confirmed", async () => {
    const { service, attempts } = createService();

    attempts["confirm"]?.mockResolvedValue(true);

    await expect(service.consume("a1")).resolves.toBeUndefined();
    expect(attempts["confirm"]).toHaveBeenCalledWith("a1", NOW.toISOString());
  });

  it("refuses an attempt another request used first", async () => {
    const { service, attempts } = createService();

    attempts["confirm"]?.mockResolvedValue(false);

    await expect(service.consume("a1")).rejects.toMatchObject({
      code: "attempt_invalid",
    });
  });
});

describe("DiscordAuthorizationService.cancel", () => {
  const input = { attemptId: "a1", projectId: "p1", userId: "u1" };

  it("cancels the attempt of the user", async () => {
    const { service, attempts } = createService();

    attempts["findAttempt"]?.mockResolvedValue(record());
    await service.cancel(input);

    expect(attempts["cancel"]).toHaveBeenCalledWith("a1");
  });

  it.each([
    { found: null, label: "unknown" },
    { found: record({ userId: "u2" }), label: "of another user" },
    { found: record({ projectId: "p2" }), label: "of another project" },
  ])("leaves an attempt that is $label", async ({ found }) => {
    const { service, attempts } = createService();

    attempts["findAttempt"]?.mockResolvedValue(found);
    await service.cancel(input);

    expect(attempts["cancel"]).not.toHaveBeenCalled();
  });
});
