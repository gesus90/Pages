import { beforeEach, expect, it, vi } from "vitest";

import { loadRoot } from "@/app/lib/local-state/root-loader";

const mocks = vi.hoisted(() => ({
  readRouteData: vi.fn(),
  recordedOwner: vi.fn(),
  claim: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  settleWithoutClaim: vi.fn(),
}));

vi.mock("@/app/lib/local-state/route-data", () => ({
  readRouteData: mocks.readRouteData,
}));
vi.mock("@/app/lib/local-state/local-state-store", () => ({
  localState: {
    recordedOwner: mocks.recordedOwner,
    claim: mocks.claim,
    save: mocks.save,
    read: mocks.read,
    settleWithoutClaim: mocks.settleWithoutClaim,
  },
}));

const root = {
  language: "en",
  theme: "system",
  designTheme: { id: "standard", stylesheet: null },
  draftOwnerId: "owner-1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue(null);
  mocks.recordedOwner.mockResolvedValue(null);
});

it("claims and saves a signed-in server answer", async () => {
  mocks.readRouteData.mockResolvedValue(root);
  const signal = new AbortController().signal;

  await expect(loadRoot(signal)).resolves.toEqual(root);
  expect(mocks.readRouteData).toHaveBeenCalledWith(
    expect.objectContaining({ endpoint: "/app-api/root", signal }),
  );
  expect(mocks.claim).toHaveBeenCalledWith("owner-1");
  expect(mocks.save).toHaveBeenCalledWith(
    "owner-1",
    "/app-api/root",
    expect.anything(),
    root,
  );
});

it("claims a signed-out answer without saving it", async () => {
  const signedOut = { ...root, draftOwnerId: null };
  mocks.readRouteData.mockResolvedValue(signedOut);

  await expect(loadRoot(new AbortController().signal)).resolves.toEqual(
    signedOut,
  );
  expect(mocks.claim).toHaveBeenCalledWith(null);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("opens matching kept settings offline", async () => {
  mocks.readRouteData.mockRejectedValue(new TypeError("offline"));
  mocks.recordedOwner.mockResolvedValue("owner-1");
  mocks.read.mockResolvedValue({ payload: root, savedAt: 42 });

  await expect(loadRoot(new AbortController().signal)).resolves.toEqual({
    ...root,
    localState: { state: "offline", savedAt: 42 },
  });
  expect(mocks.claim).toHaveBeenCalledWith("owner-1");
  expect(mocks.settleWithoutClaim).toHaveBeenCalled();
});

it("rejects kept settings belonging to a different owner", async () => {
  const error = new TypeError("offline");
  mocks.readRouteData.mockRejectedValue(error);
  mocks.recordedOwner.mockResolvedValue("owner-2");
  mocks.read.mockResolvedValue({ payload: root, savedAt: 42 });

  await expect(loadRoot(new AbortController().signal)).rejects.toBe(error);
  expect(mocks.claim).toHaveBeenCalledWith("owner-2");
  expect(mocks.settleWithoutClaim).toHaveBeenCalled();
});

it("settles waiting routes when offline without a recorded account", async () => {
  const error = new TypeError("offline");
  mocks.readRouteData.mockRejectedValue(error);

  await expect(loadRoot(new AbortController().signal)).rejects.toBe(error);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.settleWithoutClaim).toHaveBeenCalled();
});

it("passes non-network failures through without reading kept settings", async () => {
  const error = new Response(null, { status: 403 });
  mocks.readRouteData.mockRejectedValue(error);

  await expect(loadRoot(new AbortController().signal)).rejects.toBe(error);
  expect(mocks.recordedOwner).not.toHaveBeenCalled();
  expect(mocks.settleWithoutClaim).toHaveBeenCalledOnce();
});
