import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/health";

const checkHealth = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/health.server", () => ({ checkHealth }));

it.each([
  ["ok", 200],
  ["setup", 200],
  ["unavailable", 503],
])("answers the health status %s with %i", async (status, code) => {
  checkHealth.mockResolvedValue(status);
  const response = await loader();
  expect(response.status).toBe(code);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ status });
});
