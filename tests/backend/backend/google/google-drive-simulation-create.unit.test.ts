import { describe, expect, it } from "vitest";

import {
  callDrive,
  childNames,
  createSimulation,
  idOf,
  jsonBody,
  messageOf,
  multipartUpload,
  readText,
  reasonOf,
} from "./google-drive-simulation-harness";

describe("GoogleDriveSimulation metadata creation", () => {
  it("creates an entry in the root by default with Drive defaults", async () => {
    const simulation = createSimulation();
    const created = await callDrive(simulation, "/drive/v3/files", {
      body: jsonBody({}),
      method: "POST",
    });

    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      mimeType: "application/octet-stream",
      name: "Untitled",
      parents: ["sim-root"],
      size: "0",
      trashed: false,
      version: "1",
    });
    expect(idOf(created)).toMatch(/^sim-new-/u);
    expect(await childNames(simulation, "sim-root")).toContain("Untitled");
  });

  it("creates a folder below a parent and inherits the shared drive", async () => {
    const created = await callDrive(createSimulation(), "/drive/v3/files", {
      body: jsonBody({
        mimeType: "application/vnd.google-apps.folder",
        name: "Neu",
        parents: ["sim-team-common"],
      }),
      method: "POST",
    });

    expect(created.json).toMatchObject({
      driveId: "sim-shared-team",
      mimeType: "application/vnd.google-apps.folder",
      name: "Neu",
      parents: ["sim-team-common"],
    });
    expect(created.json).not.toHaveProperty("size");
  });

  it("gives every new entry its own identifier", async () => {
    const simulation = createSimulation();
    const ids = new Set<string>();

    for (let index = 0; index < 3; index += 1) {
      const created = await callDrive(simulation, "/drive/v3/files", {
        body: jsonBody({ name: "gleich" }),
        method: "POST",
      });
      ids.add(idOf(created));
    }

    expect(ids.size).toBe(3);
  });

  it("treats an unreadable or non-object body like an empty one", async () => {
    const simulation = createSimulation();

    for (const body of ["not json", "[1,2]", "null", '"text"', undefined]) {
      const created = await callDrive(simulation, "/drive/v3/files", {
        body,
        method: "POST",
      });

      expect(created.status).toBe(200);
      expect(created.json["name"]).toBe("Untitled");
    }
  });

  it("ignores fields of the wrong type", async () => {
    const created = await callDrive(createSimulation(), "/drive/v3/files", {
      body: jsonBody({ mimeType: 4, name: ["x"], parents: [7] }),
      method: "POST",
    });

    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      mimeType: "application/octet-stream",
      name: "Untitled",
      parents: ["sim-root"],
    });
  });

  it("refuses a missing parent and a parent that is no folder", async () => {
    const simulation = createSimulation();
    const missing = await callDrive(simulation, "/drive/v3/files", {
      body: jsonBody({ name: "x", parents: ["nope"] }),
      method: "POST",
    });
    const file = await callDrive(simulation, "/drive/v3/files", {
      body: jsonBody({ name: "x", parents: ["sim-readme"] }),
      method: "POST",
    });

    expect(missing.status).toBe(404);
    expect(messageOf(missing)).toBe("File not found: nope.");
    expect(file.status).toBe(404);
  });
});

describe("GoogleDriveSimulation media uploads", () => {
  it("stores a media upload with the sent type", async () => {
    const simulation = createSimulation();
    const created = await callDrive(simulation, "/upload/drive/v3/files", {
      body: "hello",
      headers: { "Content-Type": "text/plain" },
      method: "POST",
      query: { uploadType: "media" },
    });

    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      mimeType: "text/plain",
      name: "Untitled",
      parents: ["sim-root"],
      size: "5",
    });
    expect(await readText(simulation, idOf(created))).toBe("hello");
  });

  it("falls back to generic bytes for a media upload without a type", async () => {
    const created = await callDrive(
      createSimulation(),
      "/upload/drive/v3/files",
      {
        body: new Uint8Array([1, 2, 3]),
        method: "POST",
        query: { uploadType: "media" },
      },
    );

    expect(created.json["mimeType"]).toBe("application/octet-stream");
    expect(created.json["size"]).toBe("3");
  });
});

describe("GoogleDriveSimulation multipart uploads", () => {
  const multipart = { method: "POST", query: { uploadType: "multipart" } };

  it("stores name, parent, metadata type and bytes", async () => {
    const simulation = createSimulation();
    const created = await callDrive(simulation, "/upload/drive/v3/files", {
      ...multipartUpload(
        { mimeType: "text/markdown", name: "neu.md", parents: ["sim-pages"] },
        "# Titel\r\nZeile",
      ),
      ...multipart,
    });

    expect(created.json).toMatchObject({
      mimeType: "text/markdown",
      name: "neu.md",
      parents: ["sim-pages"],
    });
    expect(await readText(simulation, idOf(created))).toBe("# Titel\r\nZeile");
  });

  it("takes the media part type when the metadata names none", async () => {
    const created = await callDrive(
      createSimulation(),
      "/upload/drive/v3/files",
      {
        ...multipartUpload({ name: "a.csv" }, "a,b", "text/csv"),
        ...multipart,
      },
    );

    expect(created.json["mimeType"]).toBe("text/csv");
    expect(created.json["parents"]).toEqual(["sim-root"]);
  });

  it("defaults the media part type and the name", async () => {
    const body = [
      "--b",
      "",
      "{}",
      "--b",
      "X-Other: 1",
      "",
      "bytes",
      "--b--",
      "",
    ];
    const created = await callDrive(
      createSimulation(),
      "/upload/drive/v3/files",
      {
        body: body.join("\r\n"),
        headers: { "Content-Type": "multipart/related; boundary=b" },
        ...multipart,
      },
    );

    expect(created.json).toMatchObject({
      mimeType: "application/octet-stream",
      name: "Untitled",
    });
  });

  it("refuses an upload below a missing parent", async () => {
    const answer = await callDrive(
      createSimulation(),
      "/upload/drive/v3/files",
      {
        ...multipartUpload({ name: "x", parents: ["nope"] }, "y"),
        ...multipart,
      },
    );

    expect(answer.status).toBe(404);
  });
});

describe("GoogleDriveSimulation unreadable uploads", () => {
  const BOUNDARY = { "Content-Type": "multipart/related; boundary=b" };
  const bodies = [
    {
      description: "a part without header separator",
      headers: BOUNDARY,
      body: "--b\r\nno separator\r\n--b--",
    },
    {
      description: "a missing media part",
      headers: BOUNDARY,
      body: "--b\r\n\r\n{}\r\n--b--",
    },
    {
      description: "metadata that is no JSON",
      headers: BOUNDARY,
      body: "--b\r\n\r\n{broken\r\n--b\r\n\r\nx\r\n--b--",
    },
    {
      description: "metadata that is no object",
      headers: BOUNDARY,
      body: "--b\r\n\r\n[1]\r\n--b\r\n\r\nx\r\n--b--",
    },
    {
      description: "a multipart type without boundary",
      headers: { "Content-Type": "multipart/related" },
      body: "--b\r\n\r\n{}\r\n--b\r\n\r\nx\r\n--b--",
    },
  ];

  it.each(bodies)("refuses $description", async ({ body, headers }) => {
    const answer = await callDrive(
      createSimulation(),
      "/upload/drive/v3/files",
      {
        body,
        headers,
        method: "POST",
        query: { uploadType: "multipart" },
      },
    );

    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toBe("badContent");
  });

  it.each([["resumable"], [""]])(
    "refuses uploadType %j",
    async (uploadType) => {
      const answer = await callDrive(
        createSimulation(),
        "/upload/drive/v3/files",
        {
          body: "x",
          method: "POST",
          query: uploadType === "" ? {} : { uploadType },
        },
      );

      expect(answer.status).toBe(400);
      expect(reasonOf(answer)).toBe("badContent");
    },
  );
});
