import {
  DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DOCUMENT_MIME_TYPES,
} from "@/backend/google/GoogleDriveFormats";

/** The identifier of the simulated My Drive root; `root` is its alias. */
export const SIMULATED_ROOT_ID = "sim-root";

/** The identifier of the simulated shared drive and of its root folder. */
export const SIMULATED_SHARED_DRIVE_ID = "sim-shared-team";

/** How many files the paging folder holds; more than one page of 200. */
const PAGING_FOLDER_SIZE = 230;

/** Size of the large file: above every upload and inline read limit. */
const LARGE_FILE_BYTES = 300 * 1024 * 1024;

/** A one-pixel PNG, so the image entry has real bytes. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** One entry of the simulated Drive in process memory. */
export interface SimulatedFile {
  readonly id: string;
  name: string;
  mimeType: string;
  parents: string[];
  /** Set only on the entry put in the trash; its descendants follow it. */
  isExplicitlyTrashed: boolean;
  driveId: string | null;
  createdTime: string;
  modifiedTime: string;
  version: number;
  /** The bytes of a file, or the text a Google document exports from. */
  content: Buffer | null;
  /** The size of a file whose bytes are generated while it streams. */
  virtualSize: number | null;
}

/** One shared drive of the simulation. */
export interface SimulatedDrive {
  readonly id: string;
  readonly name: string;
}

/** The starting state of the simulated Drive. */
export interface SimulationSeed {
  readonly files: readonly SimulatedFile[];
  readonly drives: readonly SimulatedDrive[];
}

const SEED_TIME = "2026-01-15T09:30:00.000Z";

interface SeedEntry {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
  readonly mimeType?: string;
  readonly text?: string;
  readonly bytes?: Buffer;
  readonly virtualSize?: number;
  readonly driveId?: string;
  readonly isTrashed?: boolean;
}

function folder(
  id: string,
  name: string,
  parent: string | null,
  driveId?: string,
): SeedEntry {
  return {
    driveId,
    id,
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    name,
    parent,
  };
}

function textFile(
  id: string,
  name: string,
  parent: string,
  text: string,
): SeedEntry {
  return { id, mimeType: "text/plain", name, parent, text };
}

function toFile(entry: SeedEntry): SimulatedFile {
  const bytes =
    entry.bytes ??
    (entry.text === undefined ? null : Buffer.from(entry.text, "utf8"));

  return {
    content: bytes,
    createdTime: SEED_TIME,
    driveId: entry.driveId ?? null,
    id: entry.id,
    isExplicitlyTrashed: entry.isTrashed ?? false,
    mimeType: entry.mimeType ?? "application/octet-stream",
    modifiedTime: SEED_TIME,
    name: entry.name,
    parents: entry.parent === null ? [] : [entry.parent],
    version: 1,
    virtualSize: entry.virtualSize ?? null,
  };
}

function projectEntries(): SeedEntry[] {
  return [
    folder("sim-projects", "Projekte", SIMULATED_ROOT_ID),
    folder("sim-pages", "Pages", "sim-projects"),
    {
      id: "sim-concept-doc",
      mimeType: GOOGLE_DOCUMENT_MIME_TYPES.document,
      name: "Konzept",
      parent: "sim-pages",
      text: "Konzept für Pages Storage\n\nDieses Google-Dokument ist simuliert.",
    },
    {
      id: "sim-budget-sheet",
      mimeType: GOOGLE_DOCUMENT_MIME_TYPES.spreadsheet,
      name: "Budget",
      parent: "sim-pages",
      text: "Posten,Betrag\nServer,120\nLizenzen,80",
    },
    {
      id: "sim-slides",
      mimeType: GOOGLE_DOCUMENT_MIME_TYPES.presentation,
      name: "Präsentation",
      parent: "sim-pages",
      text: "Folie 1: Pages\nFolie 2: Storage",
    },
    {
      id: "sim-notes-md",
      mimeType: "text/markdown",
      name: "notizen.md",
      parent: "sim-pages",
      text: "# Notizen\n\n- Simulierte Datei\n",
    },
    {
      bytes: Buffer.from(PIXEL_PNG, "base64"),
      id: "sim-logo-png",
      mimeType: "image/png",
      name: "logo.png",
      parent: "sim-pages",
    },
    textFile("sim-readme", "README.txt", "sim-pages", "Pages Simulation\n"),
    folder("sim-archive", "Archiv", "sim-projects"),
    folder("sim-archive-2025", "2025", "sim-archive"),
    {
      bytes: Buffer.from("%PDF-1.4\n% Simulierter Bericht\n%%EOF\n", "utf8"),
      id: "sim-report-pdf",
      mimeType: "application/pdf",
      name: "bericht.pdf",
      parent: "sim-archive-2025",
    },
  ];
}

/** One file per type icon of the Storage list (PAGE-272), also by extension only. */
function typeEntries(): SeedEntry[] {
  const parent = "sim-types";
  const file = (
    id: string,
    name: string,
    mimeType: string,
    text = `${name}\n`,
  ): SeedEntry => ({ id: `sim-type-${id}`, mimeType, name, parent, text });

  return [
    folder(parent, "Dateitypen", SIMULATED_ROOT_ID),
    file("doc", "Protokoll", "application/vnd.google-apps.document"),
    file(
      "docx",
      "Lebenslauf.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    file("sheet", "Haushalt 2026", "application/vnd.google-apps.spreadsheet"),
    file("slides", "Vortrag", "application/vnd.google-apps.presentation"),
    file("pdf", "Mietvertrag.pdf", "application/pdf"),
    file("image", "Prag Altstadt.jpg", "image/jpeg"),
    file("video", "Ausflug.mp4", "video/mp4"),
    file("audio", "Interview.wav", "audio/wav"),
    file("archive", "Backup Fotos.zip", "application/zip"),
    file("code", "notizen.json", "application/json"),
    file("text", "Einkaufsliste.txt", "text/plain"),
    file("form", "Umfrage", "application/vnd.google-apps.form"),
    file("drawing", "Skizze", "application/vnd.google-apps.drawing"),
    file(
      "shortcut",
      "Verknüpfung zu Projekte",
      "application/vnd.google-apps.shortcut",
    ),
    // Drive reports only generic bytes here; the list knows it by the extension.
    file("binary", "Fotoalbum.tar.gz", "application/octet-stream"),
    file("unknown", "unbekannt.bin", "application/octet-stream"),
  ];
}

function pagingEntries(): SeedEntry[] {
  const entries: SeedEntry[] = [
    folder("sim-many", "Viele Einträge", SIMULATED_ROOT_ID),
  ];

  for (let index = 1; index <= PAGING_FOLDER_SIZE; index += 1) {
    const number = String(index).padStart(3, "0");

    entries.push(
      textFile(
        `sim-many-${number}`,
        `eintrag-${number}.txt`,
        "sim-many",
        `Eintrag ${number}\n`,
      ),
    );
  }

  return entries;
}

function specialEntries(): SeedEntry[] {
  return [
    folder("sim-conflicts", "Namenskonflikte", SIMULATED_ROOT_ID),
    textFile("sim-twin-a", "doppelt.txt", "sim-conflicts", "Erste Fassung\n"),
    textFile("sim-twin-b", "doppelt.txt", "sim-conflicts", "Zweite Fassung\n"),
    folder("sim-twin-folder", "doppelt", "sim-conflicts"),
    folder("sim-media", "Medien", SIMULATED_ROOT_ID),
    {
      id: "sim-large-video",
      mimeType: "video/mp4",
      name: "aufnahme-gross.mp4",
      parent: "sim-media",
      virtualSize: LARGE_FILE_BYTES,
    },
    textFile(
      "sim-locked-file",
      "gesperrt-vertraulich.txt",
      SIMULATED_ROOT_ID,
      "Vertraulich\n",
    ),
    folder("sim-locked-folder", "gesperrt-Ordner", SIMULATED_ROOT_ID),
    textFile("sim-root-note", "Notiz.txt", SIMULATED_ROOT_ID, "Hallo Drive\n"),
    {
      ...textFile(
        "sim-trashed-draft",
        "alter-entwurf.txt",
        SIMULATED_ROOT_ID,
        "Veralteter Entwurf\n",
      ),
      isTrashed: true,
    },
    {
      ...folder("sim-trashed-folder", "Alter Ordner", SIMULATED_ROOT_ID),
      isTrashed: true,
    },
    textFile("sim-trashed-child", "inhalt.txt", "sim-trashed-folder", "Alt\n"),
  ];
}

function sharedDriveEntries(): SeedEntry[] {
  const driveId = SIMULATED_SHARED_DRIVE_ID;

  return [
    folder(driveId, "Team-Ablage", null, driveId),
    folder("sim-team-common", "Gemeinsam", driveId, driveId),
    {
      ...textFile("sim-team-plan", "plan.txt", "sim-team-common", "Teamplan\n"),
      driveId,
    },
    {
      driveId,
      id: "sim-team-notes",
      mimeType: GOOGLE_DOCUMENT_MIME_TYPES.document,
      name: "Team-Notizen",
      parent: driveId,
      text: "Notizen des Teams",
    },
  ];
}

/**
 * Builds the starting state of the simulated Drive.
 *
 * @returns A folder tree with one file per type icon, Google documents, a large
 * file, a folder of more than 200 entries, name conflicts, trash entries,
 * locked entries and one shared drive; always the same, fresh objects.
 */
export function createSimulationSeed(): SimulationSeed {
  const entries = [
    folder(SIMULATED_ROOT_ID, "Meine Ablage", null),
    ...projectEntries(),
    ...typeEntries(),
    ...pagingEntries(),
    ...specialEntries(),
    ...sharedDriveEntries(),
  ];

  return {
    drives: [{ id: SIMULATED_SHARED_DRIVE_ID, name: "Team-Ablage" }],
    files: entries.map(toFile),
  };
}
