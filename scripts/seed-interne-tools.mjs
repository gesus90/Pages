/**
 * Seeds six demo milestones with dependencies into the "Interne Tools"
 * project.
 *
 * @remarks
 * One-shot helper for local demo data, not part of the application. Run it
 * with the dev server stopped, then start the server again so the
 * application cache picks up the inserted rows:
 *
 *   node scripts/seed-interne-tools.mjs
 *
 * The database path defaults to the Pages data directory inside the current
 * user's home directory and can be overridden with PAGES_DATABASE_PATH. The
 * script is idempotent: when demo milestones already exist, it inserts
 * nothing.
 */
import { homedir } from "node:os";
import path from "node:path";

import SqliteDatabase from "better-sqlite3";

const PROJECT_NAME = "Interne Tools";
const DEMO_MARKER = "Demo-Datensatz für die Meilenstein-Timeline.";

const MILESTONES = [
  {
    colorCustom: "#f97316",
    colorKey: "standard",
    description: `${DEMO_MARKER} Grundlegende Werkzeuge einrichten und Bestand aufnehmen.`,
    dueAt: "2026-10-16",
    iconKey: "package",
    id: "8b465e15-214d-4d40-bf1b-6cc48f569dfc",
    name: "Setup & Inventur",
    startAt: "2026-10-05",
  },
  {
    colorCustom: "#3b82f6",
    colorKey: "release",
    description: `${DEMO_MARKER} Entwurf der internen Admin-Oberfläche.`,
    dueAt: "2026-10-30",
    iconKey: "pen",
    id: "53869850-5269-49fa-95b9-54899cd512d6",
    name: "Admin-UI Entwurf",
    startAt: "2026-10-19",
  },
  {
    colorCustom: "#22c55e",
    colorKey: "marketing",
    description: `${DEMO_MARKER} Kommandozeilen-Werkzeuge für den Alltag umsetzen.`,
    dueAt: "2026-11-20",
    iconKey: "cog",
    id: "6cf98899-a385-48ca-ab83-15776db96e59",
    name: "CLI Implementierung",
    startAt: "2026-11-02",
  },
  {
    colorCustom: "#8b5cf6",
    colorKey: "review",
    description: `${DEMO_MARKER} Interne Systeme per Schnittstelle anbinden.`,
    dueAt: "2026-12-04",
    iconKey: "link",
    id: "f650852e-bcc2-47fc-86c2-1e80bddaa6fd",
    name: "API Anbindung",
    startAt: "2026-11-23",
  },
  {
    colorCustom: "#eab308",
    colorKey: "team",
    description: `${DEMO_MARKER} Absicherung der Werkzeuge durch interne Tests.`,
    dueAt: "2026-12-18",
    iconKey: "flask",
    id: "60f5478d-5bd4-48b8-a0fd-3feb935ba63f",
    name: "Interne Tests",
    startAt: "2026-12-07",
  },
  {
    colorCustom: "#ec4899",
    colorKey: "standard",
    description: `${DEMO_MARKER} Werkzeuge intern ausrollen und übergeben.`,
    dueAt: "2026-12-30",
    iconKey: "rocket",
    id: "4cb1e783-2973-4c38-89d2-951ee19a897b",
    name: "Rollout Intern",
    startAt: "2026-12-21",
  },
];

const DEPENDENCIES = [
  {
    id: "75c03c2a-2205-4ef6-891f-fbf3de8b4534",
    sourceId: "8b465e15-214d-4d40-bf1b-6cc48f569dfc",
    targetId: "53869850-5269-49fa-95b9-54899cd512d6",
  },
  {
    id: "4bc744ab-b0ec-406b-8928-ce65e1636283",
    sourceId: "53869850-5269-49fa-95b9-54899cd512d6",
    targetId: "6cf98899-a385-48ca-ab83-15776db96e59",
  },
  {
    id: "0a61a79b-763d-4883-b86e-cdb0676950ed",
    sourceId: "6cf98899-a385-48ca-ab83-15776db96e59",
    targetId: "f650852e-bcc2-47fc-86c2-1e80bddaa6fd",
  },
  {
    id: "37b208cc-49e8-4281-b9e4-3d0407c700d8",
    sourceId: "f650852e-bcc2-47fc-86c2-1e80bddaa6fd",
    targetId: "60f5478d-5bd4-48b8-a0fd-3feb935ba63f",
  },
  {
    id: "0f2f6281-7404-4be3-a467-66a18477303e",
    sourceId: "60f5478d-5bd4-48b8-a0fd-3feb935ba63f",
    targetId: "4cb1e783-2973-4c38-89d2-951ee19a897b",
  },
  {
    id: "8d3a32e1-f683-4c5d-b0be-e49b9beed8e9",
    sourceId: "53869850-5269-49fa-95b9-54899cd512d6",
    targetId: "f650852e-bcc2-47fc-86c2-1e80bddaa6fd",
  },
];

function resolveDatabasePath() {
  if (process.env.PAGES_DATABASE_PATH) {
    return path.resolve(process.env.PAGES_DATABASE_PATH);
  }

  return path.join(homedir(), ".pages", "data", "pages.db");
}

const databasePath = resolveDatabasePath();
const database = new SqliteDatabase(databasePath);

const project = database
  .prepare("SELECT id FROM projects WHERE name = ?;")
  .get(PROJECT_NAME);

if (!project) {
  console.error(`Project "${PROJECT_NAME}" not found in ${databasePath}.`);
  process.exit(1);
}

const existing = database
  .prepare("SELECT COUNT(*) AS count FROM milestones WHERE project_id = ?;")
  .get(project.id);

if (existing.count > 0) {
  console.log(
    `Project "${PROJECT_NAME}" already has milestones, inserting nothing.`,
  );
  process.exit(0);
}

const insertMilestone = database.prepare(`
  INSERT INTO milestones (
      id,
      project_id,
      name,
      description,
      status,
      start_at,
      due_at,
      color_key,
      icon_key,
      color_custom
  )
  VALUES (
      @id,
      @projectId,
      @name,
      @description,
      'open',
      @startAt,
      @dueAt,
      @colorKey,
      @iconKey,
      @colorCustom
  );
`);

const insertDependency = database.prepare(`
  INSERT INTO milestone_dependencies (
      id,
      project_id,
      source_id,
      target_id,
      link_type
  )
  VALUES (
      @id,
      @projectId,
      @sourceId,
      @targetId,
      'prerequisite'
  );
`);

const seed = database.transaction(() => {
  for (const milestone of MILESTONES) {
    insertMilestone.run({ ...milestone, projectId: project.id });
  }

  for (const dependency of DEPENDENCIES) {
    insertDependency.run({ ...dependency, projectId: project.id });
  }
});

seed();

console.log(
  `Inserted ${MILESTONES.length} milestones and ${DEPENDENCIES.length} dependencies into "${PROJECT_NAME}".`,
);
