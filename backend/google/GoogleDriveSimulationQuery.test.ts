import { describe, expect, it, vi } from "vitest";

import { readGoogleDriveSimulation } from "./GoogleDriveSimulationConfig";
import { parseSimulatedQuery } from "./GoogleDriveSimulationQuery";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

describe("simulated Drive settings", () => {
  it("requires explicit activation and refuses production", () => {
    expect(readGoogleDriveSimulation({})).toBeNull();
    expect(
      readGoogleDriveSimulation({
        PAGES_GOOGLE_DRIVE_SIMULATION: "1",
        NODE_ENV: "production",
      }),
    ).toBeNull();
    expect(
      readGoogleDriveSimulation({ PAGES_GOOGLE_DRIVE_SIMULATION: "1" }),
    ).toEqual({ scenario: "full" });
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
  });
});

describe("simulated Drive queries", () => {
  it("parses supported conditions and escaped literals", () => {
    expect(parseSimulatedQuery(" ")).toEqual([]);
    expect(
      parseSimulatedQuery(
        "'parent' in parents and trashed = false and mimeType != 'folder' and name = 'rock and roll' and name contains 'it\\'s' and fullText contains 'text'",
      ),
    ).toEqual([
      { kind: "in_parents", id: "parent" },
      { kind: "trashed", isTrashed: false },
      { kind: "mime_type", mimeType: "folder", isNegated: true },
      { kind: "name_equals", name: "rock and roll" },
      { kind: "name_contains", text: "it's" },
      { kind: "full_text", text: "text" },
    ]);
    expect(
      parseSimulatedQuery("trashed = true and mimeType = 'image/png'"),
    ).toEqual([
      { kind: "trashed", isTrashed: true },
      { kind: "mime_type", mimeType: "image/png", isNegated: false },
    ]);
  });

  it.each(["invalid", "name = 'ok' and unknown", "name = 'unterminated"])(
    "rejects unsupported query %s",
    (query) => {
      expect(parseSimulatedQuery(query)).toBeNull();
    },
  );
});
