import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

afterEach(() => {
  vi.restoreAllMocks();
});

it("places temporary files in ~/.pages/tmp instead of the service's private /tmp", () => {
  vi.spyOn(os, "homedir").mockReturnValue("/synthetic/home");
  vi.spyOn(os, "tmpdir").mockReturnValue("/private-service-tmp");

  expect(pagesTempDirectory()).toBe(
    path.join("/synthetic/home", ".pages", "tmp"),
  );
  expect(pagesTempDirectory("plan-scripts", "run")).toBe(
    path.join("/synthetic/home", ".pages", "tmp", "plan-scripts", "run"),
  );
  expect(pagesTempDirectory("x")).not.toContain("/private-service-tmp");
});
