import { describe, expect, it } from "vitest";

import {
  callDrive,
  childNames,
  createSimulation,
  idOf,
  jsonBody,
  messageOf,
  quotaOf,
  readText,
  reasonOf,
} from "./google-drive-simulation-harness";

import type { GoogleDriveSimulation } from "@/backend/google/GoogleDriveSimulation";

async function move(
  simulation: GoogleDriveSimulation,
  query: Record<string, string>,
  id = "sim-readme",
): ReturnType<typeof callDrive> {
  return callDrive(simulation, `/drive/v3/files/${id}`, {
    body: "{}",
    method: "PATCH",
    query,
  });
}

describe("GoogleDriveSimulation moving", () => {
  it("moves a file and leaves the old folder", async () => {
    const simulation = createSimulation();
    const moved = await move(simulation, {
      addParents: "sim-archive",
      removeParents: "sim-pages",
    });

    expect(moved.json["parents"]).toEqual(["sim-archive"]);
    expect(await childNames(simulation, "sim-pages")).not.toContain(
      "README.txt",
    );
    expect(await childNames(simulation, "sim-archive")).toContain("README.txt");
  });

  it("moves a tree into a shared drive", async () => {
    const simulation = createSimulation();

    await move(
      simulation,
      { addParents: "sim-team-common", removeParents: "sim-projects" },
      "sim-archive",
    );
    const inside = await callDrive(
      simulation,
      "/drive/v3/files/sim-report-pdf",
    );

    expect(inside.json["driveId"]).toBe("sim-shared-team");
  });

  it("moves a tree out of a shared drive through the root alias", async () => {
    const simulation = createSimulation();

    await move(
      simulation,
      { addParents: "root", removeParents: "sim-team-common" },
      "sim-team-plan",
    );
    const outside = await callDrive(
      simulation,
      "/drive/v3/files/sim-team-plan",
    );

    expect(outside.json).not.toHaveProperty("driveId");
    expect(outside.json["parents"]).toEqual(["sim-root"]);
  });
});

describe("GoogleDriveSimulation refused moves", () => {
  it("refuses a removal without a target", async () => {
    const answer = await move(createSimulation(), {
      removeParents: "sim-pages",
    });

    expect(answer.status).toBe(404);
    expect(messageOf(answer)).toBe("File not found: .");
  });

  it("refuses more than one new parent", async () => {
    const answer = await move(createSimulation(), {
      addParents: "sim-archive,sim-pages",
    });

    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toBe("invalidParents");
  });

  it("refuses to remove a parent the file does not have", async () => {
    const answer = await move(createSimulation(), {
      addParents: "sim-archive",
      removeParents: "sim-nowhere",
    });

    expect(answer.status).toBe(400);
    expect(messageOf(answer)).toBe("Unknown parent to remove.");
  });

  it("refuses a missing target folder", async () => {
    const answer = await move(createSimulation(), { addParents: "nope" });

    expect(answer.status).toBe(404);
  });

  it("refuses to move a folder into itself or into its own tree", async () => {
    const simulation = createSimulation();
    const intoItself = await move(
      simulation,
      { addParents: "sim-archive" },
      "sim-archive",
    );
    const intoChild = await move(
      simulation,
      { addParents: "sim-archive-2025", removeParents: "sim-projects" },
      "sim-archive",
    );

    expect(intoItself.status).toBe(400);
    expect(messageOf(intoChild)).toBe(
      "A file must have exactly one parent outside of its own tree.",
    );
  });

  it("leaves a refused move without any change", async () => {
    const simulation = createSimulation();

    await move(simulation, { addParents: "sim-archive,sim-pages" });
    const unchanged = await callDrive(simulation, "/drive/v3/files/sim-readme");

    expect(unchanged.json).toMatchObject({
      parents: ["sim-pages"],
      version: "1",
    });
  });
});

describe("GoogleDriveSimulation copy", () => {
  it("copies bytes into the parent of the source with a default name", async () => {
    const simulation = createSimulation();
    const copy = await callDrive(
      simulation,
      "/drive/v3/files/sim-readme/copy",
      {
        method: "POST",
      },
    );

    expect(copy.status).toBe(200);
    expect(copy.json).toMatchObject({
      mimeType: "text/plain",
      name: "Copy of README.txt",
      parents: ["sim-pages"],
      size: "17",
    });
    expect(idOf(copy)).not.toBe("sim-readme");
    expect(await readText(simulation, idOf(copy))).toBe("Pages Simulation\n");
  });

  it("copies into a named folder under a given name", async () => {
    const copy = await callDrive(
      createSimulation(),
      "/drive/v3/files/sim-readme/copy",
      {
        body: jsonBody({ name: "Kopie", parents: ["sim-archive"] }),
        method: "POST",
      },
    );

    expect(copy.json).toMatchObject({
      name: "Kopie",
      parents: ["sim-archive"],
    });
  });

  it("copies a Google document and keeps the virtual size of a large file", async () => {
    const simulation = createSimulation();
    const document = await callDrive(
      simulation,
      "/drive/v3/files/sim-concept-doc/copy",
      { method: "POST" },
    );
    const large = await callDrive(
      simulation,
      "/drive/v3/files/sim-large-video/copy",
      { method: "POST" },
    );

    expect(document.json["mimeType"]).toBe(
      "application/vnd.google-apps.document",
    );
    expect(document.json).not.toHaveProperty("size");
    expect(large.json["size"]).toBe(String(300 * 1024 * 1024));
    expect(large.json["parents"]).toEqual(["sim-media"]);
  });

  it("refuses to copy folders", async () => {
    const folder = await callDrive(
      createSimulation(),
      "/drive/v3/files/sim-pages/copy",
      { method: "POST" },
    );

    expect(folder.status).toBe(403);
    expect(reasonOf(folder)).toBe("cannotCopyFile");
  });

  it("refuses a missing target and a target that is no folder", async () => {
    const simulation = createSimulation();
    const copyInto = (parent: string): ReturnType<typeof callDrive> =>
      callDrive(simulation, "/drive/v3/files/sim-readme/copy", {
        body: jsonBody({ parents: [parent] }),
        method: "POST",
      });

    expect((await copyInto("nope")).status).toBe(404);
    expect((await copyInto("sim-logo-png")).status).toBe(404);
  });
});

describe("GoogleDriveSimulation delete", () => {
  it("deletes a file permanently", async () => {
    const simulation = createSimulation();
    const deleted = await callDrive(simulation, "/drive/v3/files/sim-readme", {
      method: "DELETE",
    });
    const after = await callDrive(simulation, "/drive/v3/files/sim-readme");

    expect(deleted.status).toBe(204);
    expect(after.status).toBe(404);
  });

  it("deletes a folder with its whole tree and frees the quota", async () => {
    const simulation = createSimulation();
    const before = quotaOf(await callDrive(simulation, "/drive/v3/about"));

    await callDrive(simulation, "/drive/v3/files/sim-archive", {
      method: "DELETE",
    });
    const after = quotaOf(await callDrive(simulation, "/drive/v3/about"));

    for (const id of ["sim-archive", "sim-archive-2025", "sim-report-pdf"]) {
      const answer = await callDrive(simulation, `/drive/v3/files/${id}`);

      expect(answer.status).toBe(404);
    }
    expect(before.usage - after.usage).toBe(
      "%PDF-1.4\n% Simulierter Bericht\n%%EOF\n".length,
    );
  });

  it("refuses to delete a root", async () => {
    const simulation = createSimulation();

    for (const id of ["sim-root", "root", "sim-shared-team"]) {
      const answer = await callDrive(simulation, `/drive/v3/files/${id}`, {
        method: "DELETE",
      });

      expect(answer.status).toBe(403);
      expect(reasonOf(answer)).toBe("cannotDeleteRoot");
    }
  });

  it("counts a new upload in the usage and a trashed one in the trash usage", async () => {
    const simulation = createSimulation();
    const before = quotaOf(await callDrive(simulation, "/drive/v3/about"));
    const created = await callDrive(simulation, "/upload/drive/v3/files", {
      body: "12345",
      method: "POST",
      query: { uploadType: "media" },
    });
    const after = quotaOf(await callDrive(simulation, "/drive/v3/about"));

    await callDrive(simulation, `/drive/v3/files/${idOf(created)}`, {
      body: jsonBody({ trashed: true }),
      method: "PATCH",
    });
    const trashed = quotaOf(await callDrive(simulation, "/drive/v3/about"));

    expect(after.usage - before.usage).toBe(5);
    expect(trashed.usageInDriveTrash - before.usageInDriveTrash).toBe(5);
  });
});
