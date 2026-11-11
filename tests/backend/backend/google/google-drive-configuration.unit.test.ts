import { describe, expect, it, vi } from "vitest";

import {
  listGoogleDriveOrigins,
  pickGoogleDriveOrigin,
} from "@/backend/google/GoogleDriveOrigins";
import { readGoogleDriveSimulation } from "@/backend/google/GoogleDriveSimulationConfig";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

describe("Google Drive origin configuration", () => {
  it("allows only loopback and a configured HTTPS origin", () => {
    const origins = listGoogleDriveOrigins(
      { port: 4321, publicUrl: " https://pages.example.test/path?q=1 " },
      {},
    );
    expect(origins).toEqual([
      "http://127.0.0.1:4321",
      "https://pages.example.test",
    ]);
    expect(pickGoogleDriveOrigin("https://pages.example.test", origins)).toBe(
      "https://pages.example.test",
    );
    expect(pickGoogleDriveOrigin("http://localhost:4321", origins)).toBeNull();
  });

  it("uses the environment fallback and rejects invalid or insecure URLs", () => {
    expect(
      listGoogleDriveOrigins(
        { port: 80 },
        { PAGES_PUBLIC_URL: "https://external.test/path" },
      ),
    ).toEqual(["http://127.0.0.1", "https://external.test"]);
    expect(
      listGoogleDriveOrigins(
        { port: 80, publicUrl: "http://external.test" },
        {},
      ),
    ).toEqual(["http://127.0.0.1"]);
    expect(
      listGoogleDriveOrigins({ port: 80, publicUrl: "invalid" }, {}),
    ).toEqual(["http://127.0.0.1"]);
    expect(
      listGoogleDriveOrigins(
        { port: 80, publicUrl: " " },
        { PAGES_PUBLIC_URL: "https://ignored.test" },
      ),
    ).toEqual(["http://127.0.0.1"]);
  });
});

describe("Google Drive simulation configuration", () => {
  it("requires explicit enablement and never enables production", () => {
    expect(readGoogleDriveSimulation({})).toBeNull();
    expect(
      readGoogleDriveSimulation({ PAGES_GOOGLE_DRIVE_SIMULATION: "true" }),
    ).toBeNull();
    expect(
      readGoogleDriveSimulation({
        PAGES_GOOGLE_DRIVE_SIMULATION: "1",
        NODE_ENV: "production",
      }),
    ).toBeNull();
  });

  it("reads a trimmed scenario and defaults unknown values to full", () => {
    expect(
      readGoogleDriveSimulation({
        PAGES_GOOGLE_DRIVE_SIMULATION: "1",
        PAGES_GOOGLE_DRIVE_SIMULATION_SCENARIO: " read_only ",
      }),
    ).toEqual({ scenario: "read_only" });
    expect(
      readGoogleDriveSimulation({
        PAGES_GOOGLE_DRIVE_SIMULATION: "1",
        PAGES_GOOGLE_DRIVE_SIMULATION_SCENARIO: "unknown",
      }),
    ).toEqual({ scenario: "full" });
    expect(
      readGoogleDriveSimulation({ PAGES_GOOGLE_DRIVE_SIMULATION: "1" }),
    ).toEqual({ scenario: "full" });
  });
});
