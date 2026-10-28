import { expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/page-agents";

import { formPost, pagesRequest, routeArguments } from "./route-fixture";

// The fixture reads the user context of the authentication module.
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

// The fixture reads the user context of the authentication module.
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

it("opens the plan editor instead of the retired agent definitions", () => {
  const response = loader();

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "/agents/plans?notice=direct-models",
  );
});

it("answers old form posts with a redirect to the plan editor", () => {
  const response = action(routeArguments(formPost("/agents")));

  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe(
    "/agents/plans?notice=direct-models",
  );
});

it("refuses other methods", () => {
  expect(action(routeArguments(pagesRequest("/agents"))).status).toBe(405);
});
