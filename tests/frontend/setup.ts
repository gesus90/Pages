import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

import "@testing-library/jest-dom/vitest";

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
