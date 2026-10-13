import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled, so register React DOM cleanup explicitly.
afterEach(cleanup);
