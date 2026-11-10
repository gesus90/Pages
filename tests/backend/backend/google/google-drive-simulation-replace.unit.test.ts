import { describe, expect, it } from "vitest";

import {
  callDrive,
  createSimulation,
  jsonBody,
  multipartUpload,
  readText,
  reasonOf,
} from "./google-drive-simulation-harness";

describe("GoogleDriveSimulation content replacement", () => {
  it("replaces bytes, clears the virtual size and raises the version", async () => {
    const simulation = createSimulation();
    const before = await callDrive(
      simulation,
      "/drive/v3/files/sim-large-video",
    );
    const replaced = await callDrive(
      simulation,
      "/upload/drive/v3/files/sim-large-video",
      {
        body: "klein",
        headers: { "Content-Type": "video/webm" },
        method: "PATCH",
        query: { uploadType: "media" },
      },
    );

    expect(replaced.status).toBe(200);
    expect(replaced.json).toMatchObject({
      mimeType: "video/mp4",
      size: "5",
      version: "2",
    });
    expect(replaced.json["modifiedTime"]).not.toBe(before.json["modifiedTime"]);
    expect(await readText(simulation, "sim-large-video")).toBe("klein");
  });

  it("takes a new type from multipart metadata", async () => {
    const simulation = createSimulation();
    const replaced = await callDrive(
      simulation,
      "/upload/drive/v3/files/sim-readme",
      {
        ...multipartUpload({ mimeType: "text/markdown" }, "# neu"),
        method: "PATCH",
        query: { uploadType: "multipart" },
      },
    );

    expect(replaced.json["mimeType"]).toBe("text/markdown");
    expect(await readText(simulation, "sim-readme")).toBe("# neu");
  });

  it("refuses non-PATCH requests, folders and Google documents", async () => {
    const simulation = createSimulation();
    const attempts = [
      ["sim-readme", "POST"],
      ["sim-readme", "GET"],
      ["sim-projects", "PATCH"],
      ["sim-concept-doc", "PATCH"],
    ] as const;

    for (const [id, method] of attempts) {
      const answer = await callDrive(
        simulation,
        `/upload/drive/v3/files/${id}`,
        { body: "x", method, query: { uploadType: "media" } },
      );

      expect(answer.status).toBe(403);
      expect(reasonOf(answer)).toBe("fileNotWritable");
    }

    expect(await readText(simulation, "sim-readme")).toBe("Pages Simulation\n");
  });

  it("refuses an unreadable replacement and keeps the old bytes", async () => {
    const simulation = createSimulation();
    const answer = await callDrive(
      simulation,
      "/upload/drive/v3/files/sim-readme",
      { body: "x", method: "PATCH", query: { uploadType: "resumable" } },
    );

    expect(answer.status).toBe(400);
    expect(await readText(simulation, "sim-readme")).toBe("Pages Simulation\n");
  });

  it("answers 404 for an unknown file", async () => {
    const answer = await callDrive(
      createSimulation(),
      "/upload/drive/v3/files/nope",
      { body: "x", method: "PATCH", query: { uploadType: "media" } },
    );

    expect(answer.status).toBe(404);
  });
});

describe("GoogleDriveSimulation renaming and trashing", () => {
  it("renames a file, raising version and modified time", async () => {
    const renamed = await callDrive(
      createSimulation(),
      "/drive/v3/files/sim-readme",
      { body: jsonBody({ name: "LIESMICH.txt" }), method: "PATCH" },
    );

    expect(renamed.json).toMatchObject({ name: "LIESMICH.txt", version: "2" });
    expect(renamed.json["modifiedTime"]).not.toBe("2026-01-15T09:30:00.000Z");
  });

  it("trashes a folder with its descendants without touching modified time", async () => {
    const simulation = createSimulation();
    const trashed = await callDrive(simulation, "/drive/v3/files/sim-archive", {
      body: jsonBody({ trashed: true }),
      method: "PATCH",
    });
    const nested = await callDrive(
      simulation,
      "/drive/v3/files/sim-report-pdf",
    );

    expect(trashed.json).toMatchObject({
      explicitlyTrashed: true,
      modifiedTime: "2026-01-15T09:30:00.000Z",
      trashed: true,
      version: "2",
    });
    expect(nested.json["trashed"]).toBe(true);
  });

  it("restores a trashed folder together with its descendants", async () => {
    const simulation = createSimulation();
    const restored = await callDrive(
      simulation,
      "/drive/v3/files/sim-trashed-folder",
      { body: jsonBody({ trashed: false }), method: "PATCH" },
    );
    const child = await callDrive(
      simulation,
      "/drive/v3/files/sim-trashed-child",
    );

    expect(restored.json).toMatchObject({
      explicitlyTrashed: false,
      trashed: false,
    });
    expect(child.json["trashed"]).toBe(false);
  });

  it("ignores a non-boolean trashed field and a non-text name", async () => {
    const answer = await callDrive(
      createSimulation(),
      "/drive/v3/files/sim-readme",
      { body: jsonBody({ name: 5, trashed: "yes" }), method: "PATCH" },
    );

    expect(answer.json).toMatchObject({
      name: "README.txt",
      trashed: false,
      version: "2",
    });
  });

  it("treats an unreadable body as a change without content", async () => {
    const broken = await callDrive(
      createSimulation(),
      "/drive/v3/files/sim-readme",
      { body: "{", method: "PATCH" },
    );

    expect(broken.json).toMatchObject({ name: "README.txt", version: "2" });
  });

  it("answers 404 for an unknown file", async () => {
    const answer = await callDrive(createSimulation(), "/drive/v3/files/nope", {
      body: "{}",
      method: "PATCH",
    });

    expect(answer.status).toBe(404);
  });
});
