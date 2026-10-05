import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import "@testing-library/jest-dom/vitest";

// Tests must never reach the real data of whoever runs them: Pages keeps its
// database below the home directory, so every suite gets a home of its own.
// Setting the variable here, once per suite, also survives `unstubEnvs`,
// which discards `vi.stubEnv` values before each test.
const ISOLATED_HOME = mkdtempSync(path.join(tmpdir(), "pages-test-home-"));

process.env.HOME = ISOLATED_HOME;
process.env.USERPROFILE = ISOLATED_HOME;

afterAll(() => {
  rmSync(ISOLATED_HOME, { force: true, recursive: true });
});

// jsdom does not implement the Pointer Events APIs that Radix UI's
// interactive primitives (Select, Dropdown Menu, Tooltip, ...) rely on.
// Polyfilling them keeps component tests runnable under jsdom.
beforeAll(() => {
  if (typeof Element === "undefined") {
    return;
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }

  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }

  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();

  // The setup file loads for every suite while only `tests/frontend/`
  // suites run with a DOM, so DOM cleanup must stay optional.
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
    document.documentElement.lang = "";
  }
});
