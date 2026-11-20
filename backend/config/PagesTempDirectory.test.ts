import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { pagesTempDirectory } from "./PagesTempDirectory";

it("resolves temporary folders beneath the account's Pages directory", () => {
  expect(pagesTempDirectory("streams", "example")).toBe(
    path.join(os.homedir(), ".pages", "tmp", "streams", "example"),
  );
});
