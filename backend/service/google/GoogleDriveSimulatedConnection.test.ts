import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_DRIVE_FULL_SCOPE,
  GOOGLE_DRIVE_READ_SCOPE,
  GOOGLE_DRIVE_SCOPE,
} from "@/backend/google/GoogleDriveConfig";

import { GOOGLE_DRIVE_CALLBACK_PATH } from "./GoogleDriveConnectionService";
import { GoogleDriveSimulatedConnection } from "./GoogleDriveSimulatedConnection";

import type { GoogleDriveApiClient } from "@/backend/google/GoogleDriveApiClient";

type AccountReader = GoogleDriveApiClient["readAccount"];

function connectionOf(
  grantedScopes: readonly string[],
  readAccount: AccountReader,
): GoogleDriveSimulatedConnection {
  return new GoogleDriveSimulatedConnection({
    client: { readAccount },
    grantedScopes,
  });
}

const answering = vi.fn<AccountReader>(async () => ({
  ok: true,
  value: { permissionId: "sim-permission", emailAddress: "sim@example.com" },
}));

const failing = vi.fn<AccountReader>(async () => ({
  ok: false,
  problem: "google_unreachable",
}));

describe("GoogleDriveSimulatedConnection sign-in", () => {
  it("starts no sign-in", async () => {
    const connection = connectionOf([], answering);

    await expect(connection.start()).resolves.toBeNull();
  });

  it("finishes no sign-in", async () => {
    const connection = connectionOf([], answering);

    await expect(connection.complete()).resolves.toBe("invalid");
  });
});

describe("GoogleDriveSimulatedConnection.access", () => {
  it("returns the stand-in token with the simulated account", async () => {
    const scopes = [GOOGLE_DRIVE_SCOPE];
    const connection = connectionOf(scopes, answering);

    await expect(connection.access()).resolves.toEqual({
      accessToken: "simulated-access-token",
      accountEmail: "sim@example.com",
      grantedScopes: scopes,
      ok: true,
      permissionId: "sim-permission",
    });
    expect(answering).toHaveBeenCalledWith("simulated-access-token");
  });

  it("is unavailable when the simulation does not answer", async () => {
    const connection = connectionOf([], failing);

    await expect(connection.access()).resolves.toEqual({
      ok: false,
      problem: "google_unreachable",
      state: "unavailable",
    });
  });
});

describe("GoogleDriveSimulatedConnection.getStatus", () => {
  const origins = { allowed: ["https://a.example"], current: null };

  it("reports a connected simulation with its scope needs", async () => {
    const connection = connectionOf([GOOGLE_DRIVE_SCOPE], answering);

    await expect(connection.getStatus(origins)).resolves.toEqual({
      accountEmail: "sim@example.com",
      canSignIn: false,
      isSimulation: true,
      missingSettings: [],
      needsFolderAccess: true,
      needsWriteAccess: true,
      problem: null,
      redirectUris: [`https://a.example${GOOGLE_DRIVE_CALLBACK_PATH}`],
      state: "connected",
    });
  });

  it("needs no access upgrades with the full scope", async () => {
    const connection = connectionOf(
      [GOOGLE_DRIVE_READ_SCOPE, GOOGLE_DRIVE_FULL_SCOPE],
      answering,
    );

    await expect(connection.getStatus(origins)).resolves.toMatchObject({
      needsFolderAccess: false,
      needsWriteAccess: false,
    });
  });

  it("shows an unreachable simulation as an unusable connection", async () => {
    const connection = connectionOf([], failing);

    await expect(connection.getStatus(origins)).resolves.toMatchObject({
      accountEmail: null,
      problem: "google_unreachable",
      state: "unavailable",
    });
  });
});
