import { beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { loader } from "@/app/routes/index";

import {
  ACTOR,
  pagesRequest,
  responseOf,
  routeArguments,
} from "./route-fixture";

vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getAuthenticatedUser).mockReset();
});

it("sends a signed-in visitor to the dashboard", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);

  const response = await responseOf(loader(routeArguments(pagesRequest("/"))));

  expect(response.headers.get("Location")).toBe("/dashboard");
});

it("sends an anonymous visitor to the login", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(loader(routeArguments(pagesRequest("/"))));

  expect(response.headers.get("Location")).toBe("/login");
});
