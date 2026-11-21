import { WorkItemNotFoundError } from "../../backend/error/WorkItemErrors";

import {
  DEPARTMENTS,
  PAGES,
  PERSONS,
  PROJECTS,
  TICKETS,
} from "./acceptance-data";
import { CheckLog, describeResult, hasSource } from "./check-support";

import type {
  EmbeddingModel,
  EmbeddingModelFactory,
} from "../../backend/service/search/EmbeddingModels";
import type { AgentSourceSearch } from "../../definition/AgentSourceSearch";
import type { AcceptanceContext } from "./acceptance-context";
import type { CheckResult } from "./check-support";

const ALICE = PERSONS.alice.id;
const BOB = PERSONS.bob.id;
const CARLA = PERSONS.carla.id;

/** The models the change checks search and index with. */
export interface ChangeSetup {
  readonly hybrid: EmbeddingModelFactory;
  readonly indexModel: EmbeddingModel;
}

function ticketId(key: string): string {
  const ticket = TICKETS.find((entry) => entry.key === key);
  if (!ticket) throw new Error(`Unknown ticket ${key}.`);
  return ticket.id;
}

function pageId(title: string): string {
  const page = PAGES.find((entry) => entry.title === title);
  if (!page) throw new Error(`Unknown page ${title}.`);
  return page.id;
}

function sectionsOf(
  result: AgentSourceSearch,
  sourceId: string,
): AgentSourceSearch["sections"] {
  return result.sections.filter((section) => section.sourceId === sourceId);
}

/**
 * Checks that changed, removed and new source revisions are handed over in
 * their current text before and after the next indexing run.
 * @param context - Services of the indexed database.
 * @param setup - Search and index models.
 * @param results - Shared result list.
 */
export async function checkSourceChanges(
  context: AcceptanceContext,
  setup: ChangeSetup,
  results: CheckResult[],
): Promise<void> {
  const log = new CheckLog("sourceChanges", results);
  const ticket = ticketId("RAG-2");
  const { tasks, actor } = await context.tasks(ALICE);
  const current = await tasks.getById(actor, ticket);
  await tasks.updateDescription(actor, ticket, {
    baseDescription: current.description,
    description:
      "Der Monatsexport der Zeiterfassung schreibt je Buchung eine CSV-Zeile mit Person, Tag und Stunden. Das Trennzeichen ist jetzt ein Komma, wie es die Lohnbuchhaltung verlangt.",
  });
  const paraphrase =
    "Wie bekomme ich meine Arbeitsstunden in eine Tabelle für Excel?";
  const changedQuestion = "Trennzeichen Lohnbuchhaltung";
  const stale = await context.search(setup.hybrid, {
    reader: ALICE,
    question: paraphrase,
    limit: 5,
  });
  const fresh = await context.search(setup.hybrid, {
    reader: ALICE,
    question: changedQuestion,
    limit: 5,
  });
  const freshSections = sectionsOf(fresh, ticket);
  log.record(
    "Before indexing, the outdated vector of RAG-2 is left out and counted; the keyword search hands over the current text",
    stale.staleSections > 0 &&
      sectionsOf(stale, ticket).every(
        (section) => !section.text.includes("Semikolon"),
      ) &&
      freshSections.some((section) => section.text.includes("Lohnbuchhaltung")),
    `paraphrase: ${describeResult(stale)}; changed words: ${describeResult(fresh)}`,
  );
  await context.db.execute(
    `UPDATE wiki_pages SET "content" = "content" || $addition, revision = revision + 1 WHERE id = $id;`,
    {
      id: pageId("Release checklist"),
      addition:
        "\n\n## Changelog\n\nList every migration in the changelog of the version.",
    },
  );
  const pageQuestion = "What do we have to do before shipping a new version?";
  const stalePage = await context.search(setup.hybrid, {
    reader: ALICE,
    question: pageQuestion,
    limit: 5,
  });
  const report = await context.index(setup.indexModel);
  const reindexed = await context.search(setup.hybrid, {
    reader: ALICE,
    question: changedQuestion,
    limit: 5,
  });
  const reindexedPage = await context.search(setup.hybrid, {
    reader: ALICE,
    question: pageQuestion,
    limit: 5,
  });
  log.record(
    "A changed wiki page revision is left out until indexing",
    stalePage.staleSections > 0,
    describeResult(stalePage),
  );
  log.record(
    "After indexing, both changed sources are embedded anew and no hit is outdated",
    report.indexedSources === 2 &&
      reindexed.staleSections === 0 &&
      reindexedPage.staleSections === 0 &&
      sectionsOf(reindexed, ticket).some((section) =>
        section.matchedBy.includes("vector"),
      ),
    `index: ${String(report.indexedSources)} indexed, ${String(report.writtenSections)} sections; ${describeResult(reindexed)}`,
  );
  await checkAssetRemoval(context, setup, log);
}

async function checkAssetRemoval(
  context: AcceptanceContext,
  setup: ChangeSetup,
  log: CheckLog,
): Promise<void> {
  const id = (await context.assetId("kundenmail.txt")) ?? "";
  const { service, actor } = await context.attachments(BOB);
  const question =
    "Bitte prüfen Sie unseren Empfänger, wir erhalten jede Rechnung doppelt";
  const before = await context.search(setup.hybrid, {
    reader: BOB,
    question,
    limit: 10,
  });
  await service.remove(actor, id);
  const after = await context.search(setup.hybrid, {
    reader: BOB,
    question,
    limit: 10,
  });
  const report = await context.index(setup.indexModel);
  log.record(
    "A removed asset disappears from the next search at once and from the index on the next run",
    hasSource(before, "ticket_asset", "kundenmail.txt") &&
      !hasSource(after, "ticket_asset", "kundenmail.txt") &&
      report.removedSources === 1,
    `before: ${describeResult(before)}; after: ${describeResult(after)}; index removed ${String(report.removedSources)}`,
  );
}

async function setMembership(
  context: AcceptanceContext,
  change: {
    readonly userId: string;
    readonly departmentId: string;
    readonly isMember: boolean;
  },
): Promise<void> {
  await context.db.execute(
    change.isMember
      ? "INSERT INTO department_members (user_id, department_id) VALUES ($user_id, $department_id);"
      : "DELETE FROM department_members WHERE user_id = $user_id AND department_id = $department_id;",
    { user_id: change.userId, department_id: change.departmentId },
  );
}

/**
 * Checks that a withdrawn right takes effect with the very next search and
 * download, before any indexing run.
 * @param context - Services of the indexed database.
 * @param setup - Search and index models.
 * @param results - Shared result list.
 */
export async function checkRevocation(
  context: AcceptanceContext,
  setup: ChangeSetup,
  results: CheckResult[],
): Promise<void> {
  const log = new CheckLog("revocation", results);
  const question = "Which log shows that the refresh token was revoked?";
  const traceId = (await context.assetId("refresh-trace.log")) ?? "";
  const membership = {
    userId: ALICE,
    departmentId: DEPARTMENTS.development.id,
  };
  const before = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  await setMembership(context, { ...membership, isMember: false });
  const withdrawn = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  await log.expectFailure(
    "Without the department Entwicklung, Alice can no longer download the asset of RAG-1",
    async () => context.download(ALICE, traceId),
    (error) => error instanceof WorkItemNotFoundError,
  );
  await setMembership(context, { ...membership, isMember: true });
  const restored = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  log.record(
    "A removed department membership hides every source of Plattform from the next search; restoring it shows them again",
    before.sections.some(
      (section) => section.projectId === PROJECTS.platform.id,
    ) &&
      withdrawn.sections.every(
        (section) => section.projectId !== PROJECTS.platform.id,
      ) &&
      hasSource(restored, "ticket_asset", "refresh-trace.log"),
    `before: ${describeResult(before)}; withdrawn: ${describeResult(withdrawn)}; restored: ${describeResult(restored)}`,
  );
  const rotation = "How often are the signing keys of session tokens rotated?";
  const security = { userId: ALICE, departmentId: DEPARTMENTS.security.id };
  await setMembership(context, { ...security, isMember: false });
  const withoutSecurity = await context.search(setup.hybrid, {
    reader: ALICE,
    question: rotation,
    limit: 10,
  });
  await setMembership(context, { ...security, isMember: true });
  log.record(
    "Without the department Sicherheit, RAG-3 is hidden from Alice at once",
    !hasSource(withoutSecurity, "ticket", "RAG-3"),
    describeResult(withoutSecurity),
  );
  await checkTicketDepartment(context, setup, log);
  await checkReleaseWithdrawal(context, setup, log);
}

async function checkTicketDepartment(
  context: AcceptanceContext,
  setup: ChangeSetup,
  log: CheckLog,
): Promise<void> {
  const parameters = {
    work_item_id: ticketId("RAG-5"),
    department_id: DEPARTMENTS.security.id,
  };
  const question = "Upload limit for ticket attachments";
  const before = await context.search(setup.hybrid, {
    reader: CARLA,
    question,
    limit: 10,
  });
  await context.db.execute(
    "INSERT INTO work_item_departments (work_item_id, department_id) VALUES ($work_item_id, $department_id);",
    parameters,
  );
  const after = await context.search(setup.hybrid, {
    reader: CARLA,
    question,
    limit: 10,
  });
  await context.db.execute(
    "DELETE FROM work_item_departments WHERE work_item_id = $work_item_id AND department_id = $department_id;",
    parameters,
  );
  log.record(
    "A department added to RAG-5 hides it from Carla with the next search",
    hasSource(before, "ticket", "RAG-5") &&
      !hasSource(after, "ticket", "RAG-5"),
    `before: ${describeResult(before)}; after: ${describeResult(after)}`,
  );
}

async function checkReleaseWithdrawal(
  context: AcceptanceContext,
  setup: ChangeSetup,
  log: CheckLog,
): Promise<void> {
  const id = (await context.assetId("refresh-trace.log")) ?? "";
  const { service, actor } = await context.attachments(ALICE);
  const question = "Which log shows that the refresh token was revoked?";
  await service.setSearchRelease(actor, id, false);
  const withdrawn = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  const removal = await context.index(setup.indexModel);
  await service.setSearchRelease(actor, id, true);
  const indexing = await context.index(setup.indexModel);
  const released = await context.search(setup.hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  log.record(
    "A withdrawn asset release hides the asset at once, the next run removes its sections; a new release indexes it again",
    !hasSource(withdrawn, "ticket_asset", "refresh-trace.log") &&
      removal.removedSources === 1 &&
      indexing.indexedSources === 1 &&
      hasSource(released, "ticket_asset", "refresh-trace.log"),
    `withdrawn: ${describeResult(withdrawn)}; removed ${String(removal.removedSources)}, indexed ${String(indexing.indexedSources)}`,
  );
}

/**
 * Checks that archived tickets and projects leave the search with the next search.
 * @param context - Services of the indexed database.
 * @param hybrid - Model of the hybrid search.
 * @param results - Shared result list.
 */
export async function checkArchiving(
  context: AcceptanceContext,
  hybrid: EmbeddingModelFactory,
  results: CheckResult[],
): Promise<void> {
  const log = new CheckLog("archiving", results);
  const admin = await context.tasks(PERSONS.admin.id);
  const question = "Wie lange hat die letzte Wiederherstellung gedauert?";
  const before = await context.search(hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  await admin.tasks.archive(admin.actor, ticketId("RAG-4"));
  const after = await context.search(hybrid, {
    reader: ALICE,
    question,
    limit: 10,
  });
  const byKey = await context.search(hybrid, {
    reader: ALICE,
    question: "RAG-4",
    limit: 10,
  });
  log.record(
    "An archived ticket and its released asset leave the search at once, also by ticket number",
    hasSource(before, "ticket", "RAG-4") &&
      !hasSource(after, "ticket", "RAG-4") &&
      !hasSource(after, "ticket_asset", "restore-protokoll.txt") &&
      !hasSource(byKey, "ticket", "RAG-4"),
    `before: ${describeResult(before)}; after: ${describeResult(after)}; by key: ${describeResult(byKey)}`,
  );
  const salesQuestion = "Welche Vorlage nutze ich für Angebote an Großkunden?";
  const salesBefore = await context.search(hybrid, {
    reader: BOB,
    question: salesQuestion,
    limit: 10,
  });
  await admin.projects.archive(admin.actor, PROJECTS.sales.id);
  const salesAfter = await context.search(hybrid, {
    reader: BOB,
    question: salesQuestion,
    limit: 10,
  });
  log.record(
    "An archived project takes its tickets and project pages out of the search at once",
    salesBefore.sections.some(
      (section) => section.projectId === PROJECTS.sales.id,
    ) &&
      salesAfter.sections.every(
        (section) => section.projectId !== PROJECTS.sales.id,
      ),
    `before: ${describeResult(salesBefore)}; after: ${describeResult(salesAfter)}`,
  );
}
