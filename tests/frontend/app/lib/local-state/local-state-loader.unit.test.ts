import { beforeEach, expect, it, vi } from "vitest";

import {
  isUnreachable,
  loadLocalFirst,
  loadServerFirst,
  localStateRoute,
  markLocalStateRouteOpen,
} from "@/app/lib/local-state/local-state-loader";

import type { LocalStateKind } from "@/app/lib/local-state/local-state-store";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  remove: vi.fn(),
  whenClaimed: vi.fn(),
  audience: vi.fn(),
}));

vi.mock("@/app/lib/local-state/local-state-store", () => ({
  localState: {
    read: mocks.read,
    remove: mocks.remove,
    whenClaimed: mocks.whenClaimed,
  },
}));
vi.mock("@/app/lib/local-state/local-state-audience", () => ({
  whenLocalStateAudienceSettled: mocks.audience,
}));

interface Answer {
  readonly name: string;
}

const kind: LocalStateKind<Answer> = {
  schemaVersion: 1,
  isPayload: (value: unknown): value is Answer =>
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockReset();
  mocks.read.mockResolvedValue(null);
  mocks.remove.mockResolvedValue(undefined);
  mocks.whenClaimed.mockResolvedValue(undefined);
  mocks.audience.mockResolvedValue(undefined);
});

it("uses path and query as the route key", () => {
  expect(
    localStateRoute(new URL("https://pages.invalid/tasks?view=board#top")),
  ).toBe("/tasks?view=board");
});

it("opens a kept answer immediately after the audience settles", async () => {
  mocks.read.mockResolvedValue({ payload: { name: "kept" }, savedAt: 123 });
  const server = vi.fn().mockResolvedValue({ name: "server" });

  await expect(loadLocalFirst("/tasks", kind, server)).resolves.toEqual({
    name: "kept",
    localState: { state: "stale", savedAt: 123 },
  });
  expect(mocks.audience).toHaveBeenCalledOnce();
  expect(mocks.whenClaimed).toHaveBeenCalledOnce();
  expect(server).not.toHaveBeenCalled();
});

it("revalidates an open route until all its open marks are removed", async () => {
  mocks.read.mockResolvedValue({ payload: { name: "kept" }, savedAt: 123 });
  const server = vi.fn().mockResolvedValue({ name: "server" });
  const closeFirst = markLocalStateRouteOpen("/tasks");
  const closeSecond = markLocalStateRouteOpen("/tasks");
  closeFirst();

  try {
    await expect(loadLocalFirst("/tasks", kind, server)).resolves.toEqual({
      name: "server",
    });
  } finally {
    closeSecond();
  }
  await expect(loadLocalFirst("/tasks", kind, server)).resolves.toMatchObject({
    name: "kept",
  });
  expect(server).toHaveBeenCalledOnce();
});

it("removes a no-longer-current answer before asking the server", async () => {
  mocks.read.mockResolvedValue({ payload: { name: "old" }, savedAt: 123 });
  const currentKind: LocalStateKind<Answer> = {
    ...kind,
    isCurrent: () => false,
  };
  const server = vi.fn().mockResolvedValue({ name: "new" });

  await expect(loadLocalFirst("/tasks", currentKind, server)).resolves.toEqual({
    name: "new",
  });
  expect(mocks.remove).toHaveBeenCalledWith("/tasks");
});

it.each([loadLocalFirst, loadServerFirst])(
  "falls back offline when the server is unreachable",
  async (load) => {
    const close = markLocalStateRouteOpen("/tasks");
    mocks.read.mockResolvedValue({ payload: { name: "kept" }, savedAt: 123 });
    try {
      await expect(
        load("/tasks", kind, async () => {
          throw new TypeError("offline");
        }),
      ).resolves.toEqual({
        name: "kept",
        localState: { state: "offline", savedAt: 123 },
      });
    } finally {
      close();
    }
  },
);

it.each([401, 403, 404, 302])(
  "removes kept data on refusal or redirect %s",
  async (status) => {
    const error = new Response(null, {
      status,
      headers: status === 302 ? { Location: "/login" } : {},
    });
    await expect(
      loadServerFirst("/tasks", kind, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(mocks.remove).toHaveBeenCalledWith("/tasks");
  },
);

it("propagates failures without a usable kept answer", async () => {
  const error = new Response(null, { status: 503 });
  await expect(
    loadServerFirst("/tasks", kind, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it.each([
  [502, true],
  [503, true],
  [504, true],
  [500, false],
  [403, false],
])("classifies status %s as unreachable: %s", (status, expected) => {
  expect(isUnreachable(new Response(null, { status }))).toBe(expected);
});
