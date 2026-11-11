import { describe, expect, it } from "vitest";

import {
  GOOGLE_DRIVE_FULL_SCOPE,
  GOOGLE_DRIVE_READ_SCOPE,
} from "@/backend/google/GoogleDriveConfig";
import { SIMULATED_ACCOUNT } from "@/backend/google/GoogleDriveSimulation";

import {
  callDrive,
  capabilitiesOf,
  createSimulation,
  idOf,
  messageOf,
  quotaOf,
  reasonOf,
} from "./google-drive-simulation-harness";

describe("GoogleDriveSimulation scenarios", () => {
  it("names the scopes of each scenario", () => {
    expect(createSimulation("full").grantedScopes()).toEqual([
      GOOGLE_DRIVE_FULL_SCOPE,
    ]);
    expect(createSimulation("item_forbidden").grantedScopes()).toEqual([
      GOOGLE_DRIVE_FULL_SCOPE,
    ]);
    expect(createSimulation("read_only").grantedScopes()).toEqual([
      GOOGLE_DRIVE_READ_SCOPE,
    ]);
  });

  it("refuses every address outside the Drive API like a network failure", async () => {
    const simulation = createSimulation();

    await expect(
      simulation.fetch("https://example.test/drive/v3/about", {}),
    ).rejects.toThrow("answers no other address");
  });

  it("does not answer at all in the unreachable scenario", async () => {
    const simulation = createSimulation("unreachable");

    await expect(callDrive(simulation, "/drive/v3/about")).rejects.toThrow(
      "Google Drive unreachable",
    );
  });

  it("refuses every change in the read_only scenario", async () => {
    const simulation = createSimulation("read_only");
    const refused = await callDrive(simulation, "/drive/v3/files", {
      body: JSON.stringify({ name: "x" }),
      method: "POST",
    });
    const deleted = await callDrive(simulation, "/drive/v3/files/sim-readme", {
      method: "DELETE",
    });

    expect(refused.status).toBe(403);
    expect(reasonOf(refused)).toBe("insufficientPermissions");
    expect(deleted.status).toBe(403);
  });

  it("still reads in the read_only scenario but shows nothing as editable", async () => {
    const simulation = createSimulation("read_only");
    const read = await callDrive(simulation, "/drive/v3/files/sim-readme");

    expect(read.status).toBe(200);
    expect(capabilitiesOf(read)).toMatchObject({
      canDelete: false,
      canEdit: false,
      canRename: false,
      canTrash: false,
      canUntrash: false,
    });
  });
});

describe("GoogleDriveSimulation routing", () => {
  it("answers an unknown address with 404", async () => {
    const simulation = createSimulation();
    const unknown = await callDrive(simulation, "/drive/v3/nothing");

    expect(unknown.status).toBe(404);
    expect(messageOf(unknown)).toBe("Unknown Drive API address.");
  });

  it("answers a lowercase method name like its uppercase form", async () => {
    const simulation = createSimulation();
    const lower = await simulation.fetch(
      "https://www.googleapis.com/drive/v3/files/sim-readme",
      { method: "get" },
    );

    expect(lower.status).toBe(200);
  });

  it("answers only GET on the about address", async () => {
    const simulation = createSimulation();
    const post = await callDrive(simulation, "/drive/v3/about", {
      method: "POST",
    });

    expect(post.status).toBe(404);
  });

  it("answers a GET on the upload address as unknown", async () => {
    const simulation = createSimulation();
    const answer = await callDrive(simulation, "/upload/drive/v3/files");

    expect(answer.status).toBe(404);
  });
});

describe("GoogleDriveSimulation about", () => {
  it("reports the account and the export formats", async () => {
    const simulation = createSimulation();
    const about = await callDrive(simulation, "/drive/v3/about");

    expect(about.status).toBe(200);
    expect(about.json["user"]).toMatchObject({
      emailAddress: SIMULATED_ACCOUNT.emailAddress,
      permissionId: SIMULATED_ACCOUNT.permissionId,
    });
    expect(about.json["exportFormats"]).toHaveProperty(
      "application/vnd.google-apps.document",
    );
    expect(about.json["maxUploadSize"]).toBe(String(5 * 1024 ** 4));
  });

  it("reports the storage quota with the part in the trash", async () => {
    const simulation = createSimulation();
    const quota = quotaOf(await callDrive(simulation, "/drive/v3/about"));

    expect(quota.limit).toBe(15 * 1024 * 1024 * 1024);
    expect(quota.usage).toBeGreaterThan(300 * 1024 * 1024);
    expect(quota.usageInDrive).toBe(quota.usage);
    expect(quota.usageInDriveTrash).toBeGreaterThan(0);
    expect(quota.usageInDriveTrash).toBeLessThan(quota.usage);
  });
});

describe("GoogleDriveSimulation file resources", () => {
  it("reads a file with its capabilities, size and trash state", async () => {
    const simulation = createSimulation();
    const note = await callDrive(simulation, "/drive/v3/files/sim-root-note");

    expect(note.json).toMatchObject({
      id: "sim-root-note",
      kind: "drive#file",
      mimeType: "text/plain",
      name: "Notiz.txt",
      parents: ["sim-root"],
      size: String("Hallo Drive\n".length),
      trashed: false,
      version: "1",
    });
    expect(capabilitiesOf(note)).toMatchObject({
      canCopy: true,
      canEdit: true,
    });
    expect(note.json).not.toHaveProperty("driveId");
  });

  it("gives folders and Google documents no size and folders no copy", async () => {
    const simulation = createSimulation();
    const folder = await callDrive(simulation, "/drive/v3/files/sim-projects");
    const document = await callDrive(
      simulation,
      "/drive/v3/files/sim-concept-doc",
    );

    expect(capabilitiesOf(folder)["canCopy"]).toBe(false);
    expect(folder.json).not.toHaveProperty("size");
    expect(document.json).not.toHaveProperty("size");
  });

  it("reports the shared drive and the virtual size", async () => {
    const simulation = createSimulation();
    const shared = await callDrive(simulation, "/drive/v3/files/sim-team-plan");
    const large = await callDrive(
      simulation,
      "/drive/v3/files/sim-large-video",
    );

    expect(shared.json["driveId"]).toBe("sim-shared-team");
    expect(large.json["size"]).toBe(String(300 * 1024 * 1024));
  });

  it("resolves the root alias and encoded identifiers", async () => {
    const simulation = createSimulation();
    const root = await callDrive(simulation, "/drive/v3/files/root");
    const encoded = await callDrive(simulation, "/drive/v3/files/sim%2Dreadme");

    expect(idOf(root)).toBe("sim-root");
    expect(root.json["parents"]).toEqual([]);
    expect(idOf(encoded)).toBe("sim-readme");
  });

  it("reports a trashed entry and the descendants of a trashed folder", async () => {
    const simulation = createSimulation();
    const draft = await callDrive(
      simulation,
      "/drive/v3/files/sim-trashed-draft",
    );
    const child = await callDrive(
      simulation,
      "/drive/v3/files/sim-trashed-child",
    );

    expect(draft.json).toMatchObject({
      explicitlyTrashed: true,
      trashed: true,
    });
    expect(child.json).toMatchObject({
      explicitlyTrashed: false,
      trashed: true,
    });
  });

  it("answers 404 for an unknown file", async () => {
    const simulation = createSimulation();
    const answer = await callDrive(simulation, "/drive/v3/files/missing");

    expect(answer.status).toBe(404);
    expect(reasonOf(answer)).toBe("notFound");
    expect(messageOf(answer)).toBe("File not found: missing.");
  });
});

describe("GoogleDriveSimulation shared drives", () => {
  it("lists and reads the shared drive", async () => {
    const simulation = createSimulation();
    const list = await callDrive(simulation, "/drive/v3/drives");
    const read = await callDrive(
      simulation,
      "/drive/v3/drives/sim-shared-team",
    );

    expect(list.json).toMatchObject({
      drives: [
        { id: "sim-shared-team", kind: "drive#drive", name: "Team-Ablage" },
      ],
      kind: "drive#driveList",
    });
    expect(list.json).not.toHaveProperty("nextPageToken");
    expect(read.json).toMatchObject({
      id: "sim-shared-team",
      kind: "drive#drive",
    });
  });

  it("answers 404 for an unknown shared drive", async () => {
    const simulation = createSimulation();
    const missing = await callDrive(simulation, "/drive/v3/drives/nope");

    expect(missing.status).toBe(404);
    expect(messageOf(missing)).toBe("Shared drive not found: nope.");
  });

  it("rejects a page token it did not issue and pages past the end", async () => {
    const simulation = createSimulation();
    const badToken = await callDrive(simulation, "/drive/v3/drives", {
      query: { pageToken: "garbage" },
    });
    const beyond = await callDrive(simulation, "/drive/v3/drives", {
      query: { pageToken: "sim-page-1" },
    });

    expect(badToken.status).toBe(400);
    expect(messageOf(badToken)).toBe("Invalid page token.");
    expect(beyond.json["drives"]).toEqual([]);
  });
});

describe("GoogleDriveSimulation metadata defaults", () => {
  it("creates an untitled root entry when the request body is unreadable", async () => {
    const simulation = createSimulation();
    const answer = await callDrive(simulation, "/drive/v3/files", {
      body: "not json",
      method: "POST",
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      mimeType: "application/octet-stream",
      name: "Untitled",
      parents: ["sim-root"],
    });
  });
});
