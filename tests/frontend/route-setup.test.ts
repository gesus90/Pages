import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

vi.mock("@/app/lib/setup/setup-actions.server", () => ({
  handleSetupAction: vi.fn(),
}));

import { handleSetupAction } from "@/app/lib/setup/setup-actions.server";
import {
  action,
  clientAction,
  loader,
  shouldRevalidate,
} from "@/app/routes/setup";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

const TOKEN = "valid-token";

function useRuntime(isPending: boolean): PagesRuntime {
  const runtime = {
    getSuggestedDatabasePath: () => "/data/pages.duckdb",
    isSetupPending: () => isPending,
    verifySetupToken: (candidate: unknown) => candidate === TOKEN,
  } as unknown as PagesRuntime;

  vi.mocked(getPagesRuntime).mockResolvedValue(runtime);

  return runtime;
}

function load(url: string): ReturnType<typeof loader> {
  return loader({ request: new Request(url) } as Parameters<typeof loader>[0]);
}

describe("setup loader", () => {
  beforeEach(() => {
    useRuntime(true);
  });

  it("grants access for the token of the setup link", async () => {
    await expect(
      load(`http://pages.invalid/setup?token=${TOKEN}`),
    ).resolves.toEqual({
      access: { suggestedDatabasePath: "/data/pages.duckdb", token: TOKEN },
      hasRejectedToken: false,
      status: "pending",
    });
  });

  it("asks for the token without one and reveals nothing", async () => {
    await expect(load("http://pages.invalid/setup")).resolves.toEqual({
      access: null,
      hasRejectedToken: false,
      status: "pending",
    });
    await expect(load("http://pages.invalid/setup?token=old")).resolves.toEqual(
      {
        access: null,
        hasRejectedToken: true,
        status: "pending",
      },
    );
  });

  it("only offers the sign-in after the setup finished", async () => {
    useRuntime(false);

    await expect(
      load(`http://pages.invalid/setup?token=${TOKEN}`),
    ).resolves.toEqual({ status: "completed" });
  });
});

describe("setup action", () => {
  it("only accepts POST requests", async () => {
    await expect(
      action({
        request: new Request("http://pages.invalid/setup", { method: "PUT" }),
      } as Parameters<typeof action>[0]),
    ).rejects.toMatchObject({ status: 405 });
  });

  it("passes the request with the runtime to the setup actions", async () => {
    const runtime = useRuntime(true);
    const request = new Request("http://pages.invalid/setup", {
      method: "POST",
    });
    const answer = new Response(null, { status: 302 });

    vi.mocked(handleSetupAction).mockResolvedValue(answer);

    await expect(
      action({ request } as Parameters<typeof action>[0]),
    ).resolves.toBe(answer);
    expect(handleSetupAction).toHaveBeenCalledWith(runtime, request);
  });
});

describe("setup client action", () => {
  function createRequest(intent: string | null): Request {
    const body = new URLSearchParams();

    if (intent !== null) {
      body.set("intent", intent);
    }

    return new Request("http://pages.invalid/setup", { body, method: "POST" });
  }

  function run(
    intent: string | null,
    serverAction: () => Promise<unknown>,
  ): ReturnType<typeof clientAction> {
    return clientAction({
      request: createRequest(intent),
      serverAction,
    } as unknown as Parameters<typeof clientAction>[0]);
  }

  it("passes the server answer through", async () => {
    const answer = { intent: "complete", error: "failed" };

    await expect(run("complete", async () => answer)).resolves.toBe(answer);
  });

  it("turns a lost connection into an inline answer", async () => {
    await expect(
      run("check-database-path", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).resolves.toEqual({ error: "network", intent: "check-database-path" });
  });

  it("lets redirects and unknown requests through", async () => {
    const redirect = new Response(null, { status: 302 });

    await expect(
      run("complete", async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
    await expect(
      run(null, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow("Failed to fetch");
  });
});

describe("setup revalidation", () => {
  function decide(
    intent: string | null,
    defaultShouldRevalidate = true,
  ): boolean {
    const formData = new FormData();

    if (intent !== null) {
      formData.set("intent", intent);
    }

    return shouldRevalidate({
      defaultShouldRevalidate,
      formData,
    } as Parameters<typeof shouldRevalidate>[0]);
  }

  it("skips reloading after checks that run while typing", () => {
    expect(decide("check-database-path")).toBe(false);
    expect(decide("verify-token")).toBe(false);
  });

  it("follows the default otherwise", () => {
    expect(decide("complete")).toBe(true);
    expect(decide("complete", false)).toBe(false);
    expect(
      shouldRevalidate({
        defaultShouldRevalidate: true,
      } as Parameters<typeof shouldRevalidate>[0]),
    ).toBe(true);
  });
});
