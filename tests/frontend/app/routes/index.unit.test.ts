import { beforeEach, expect, it, vi } from "vitest";

import { localState } from "@/app/lib/local-state/local-state-store";
import { clientLoader } from "@/app/routes/index";

import { responseOf } from "./route-fixture";

vi.mock("@/app/lib/local-state/local-state-store", () => ({
  localState: {
    whenClaimed: vi.fn(async (): Promise<void> => undefined),
    currentOwner: vi.fn(),
  },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(localState.currentOwner).mockReset();
});

it("sends a signed-in visitor to the dashboard", async () => {
  vi.mocked(localState.currentOwner).mockReturnValue("user-1");

  const response = await responseOf(clientLoader());

  expect(response.headers.get("Location")).toBe("/dashboard");
});

it("sends an anonymous visitor to the login", async () => {
  vi.mocked(localState.currentOwner).mockReturnValue(null);

  const response = await responseOf(clientLoader());

  expect(response.headers.get("Location")).toBe("/login");
});
