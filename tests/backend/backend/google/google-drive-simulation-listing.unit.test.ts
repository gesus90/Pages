import { describe, expect, it } from "vitest";

import {
  callDrive,
  createSimulation,
  fileNames,
  messageOf,
  reasonOf,
} from "./google-drive-simulation-harness";

const FOLDER_TYPE = "application/vnd.google-apps.folder";

async function search(
  query: Record<string, string>,
): ReturnType<typeof callDrive> {
  return callDrive(createSimulation(), "/drive/v3/files", { query });
}

describe("GoogleDriveSimulation ordering and filters", () => {
  it("lists a folder in natural name order", async () => {
    const answer = await search({
      q: "'sim-pages' in parents and trashed = false",
    });

    expect(fileNames(answer)).toEqual([
      "Budget",
      "Konzept",
      "logo.png",
      "notizen.md",
      "Präsentation",
      "README.txt",
    ]);
  });

  it("sorts folders before files", async () => {
    const answer = await search({
      q: "'sim-root' in parents and trashed = false",
    });

    expect(fileNames(answer)).toEqual([
      "Dateitypen",
      "gesperrt-Ordner",
      "Medien",
      "Namenskonflikte",
      "Projekte",
      "Viele Einträge",
      "gesperrt-vertraulich.txt",
      "Notiz.txt",
    ]);
  });

  it("filters by mime type and its negation", async () => {
    const folders = await search({
      q: `'sim-projects' in parents and mimeType = '${FOLDER_TYPE}'`,
    });
    const files = await search({
      q: `'sim-conflicts' in parents and mimeType != '${FOLDER_TYPE}'`,
    });

    expect(fileNames(folders)).toEqual(["Archiv", "Pages"]);
    expect(fileNames(files)).toEqual(["doppelt.txt", "doppelt.txt"]);
  });

  it("filters by exact name and by name part, ignoring case", async () => {
    const equal = await search({ q: "name = 'doppelt'" });
    const contains = await search({ q: "name contains 'NOTIZ'" });

    expect(fileNames(equal)).toEqual(["doppelt"]);
    expect(fileNames(contains)).toEqual([
      "Notiz.txt",
      "notizen.json",
      "notizen.md",
      "Team-Notizen",
    ]);
  });

  it("filters by full text in content and name, ignoring case", async () => {
    const content = await search({ q: "fullText contains 'zweite fassung'" });
    const name = await search({ q: "fullText contains 'readme'" });

    expect(fileNames(content)).toEqual(["doppelt.txt"]);
    expect(fileNames(name)).toEqual(["README.txt"]);
  });

  it("refuses a query it does not understand", async () => {
    const answer = await search({ q: "starred = true" });

    expect(answer.status).toBe(400);
    expect(reasonOf(answer)).toBe("invalid");
  });
});

describe("GoogleDriveSimulation trash and shared drive search", () => {
  it("lists the trashed entries together with trashed descendants", async () => {
    const trashed = await search({ q: "trashed = true" });

    expect(fileNames(trashed)).toEqual([
      "Alter Ordner",
      "alter-entwurf.txt",
      "inhalt.txt",
    ]);
  });

  it("never lists roots", async () => {
    const everything = await search({ pageSize: "1000" });
    const names = fileNames(everything);

    expect(names).not.toContain("Meine Ablage");
    expect(names).not.toContain("Team-Ablage");
  });

  it("restricts the search to a shared drive with corpora=drive", async () => {
    const inDrive = await search({
      corpora: "drive",
      driveId: "sim-shared-team",
    });
    const other = await search({ corpora: "drive", driveId: "other" });

    expect(fileNames(inDrive)).toEqual([
      "Gemeinsam",
      "plan.txt",
      "Team-Notizen",
    ]);
    expect(fileNames(other)).toEqual([]);
  });

  it("ignores driveId without corpora=drive", async () => {
    const ignored = await search({
      driveId: "sim-shared-team",
      q: "name = 'README.txt'",
    });

    expect(fileNames(ignored)).toEqual(["README.txt"]);
  });
});

describe("GoogleDriveSimulation paging", () => {
  const folder = "'sim-many' in parents";

  it("pages through a large folder with page tokens", async () => {
    const first = await search({ pageSize: "100", q: folder });
    const second = await search({
      pageSize: "100",
      pageToken: "sim-page-100",
      q: folder,
    });
    const third = await search({
      pageSize: "100",
      pageToken: "sim-page-200",
      q: folder,
    });

    expect(first.json["files"]).toHaveLength(100);
    expect(first.json["nextPageToken"]).toBe("sim-page-100");
    expect(first.json["kind"]).toBe("drive#fileList");
    expect(first.json["incompleteSearch"]).toBe(false);
    expect(second.json["nextPageToken"]).toBe("sim-page-200");
    expect(third.json["files"]).toHaveLength(30);
    expect(third.json).not.toHaveProperty("nextPageToken");
    expect(fileNames(third)[0]).toBe("eintrag-201.txt");
  });

  it("falls back to the default page size for unusable values", async () => {
    for (const pageSize of ["0", "-5", "abc", "1.5"]) {
      const answer = await search({ pageSize, q: folder });

      expect(answer.json["files"]).toHaveLength(100);
    }
  });

  it("caps the page size at the maximum", async () => {
    const capped = await search({ pageSize: "5000", q: folder });

    expect(capped.json["files"]).toHaveLength(230);
    expect(capped.json).not.toHaveProperty("nextPageToken");
  });

  it("rejects page tokens it did not issue", async () => {
    for (const pageToken of ["abc", "sim-page-x", "other-5"]) {
      const answer = await search({ pageToken });

      expect(answer.status).toBe(400);
      expect(messageOf(answer)).toBe("Invalid page token.");
    }
  });
});
