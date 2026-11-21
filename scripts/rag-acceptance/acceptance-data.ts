/**
 * Synthetic data of the RAG acceptance: departments, persons with different
 * rights, projects, tickets, wiki pages, ticket assets and the fixed German
 * and English question set with the expected sources.
 * @remarks
 * Every identifier is fixed, so a repeated run produces comparable results.
 * The data describes no real person, project or customer.
 */

/** A person of the acceptance and what the rights are meant to allow. */
export interface AcceptancePerson {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
  readonly isAdmin: boolean;
  readonly departmentIds: readonly string[];
  readonly purpose: string;
}

/** A ticket written directly into the disposable database. */
export interface AcceptanceTicket {
  readonly id: string;
  readonly key: string;
  readonly number: number;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  /** Departments of the ticket itself; empty means the whole project sees it. */
  readonly departmentIds: readonly string[];
  readonly createdBy: string;
}

/** A wiki page written directly into the disposable database. */
export interface AcceptancePage {
  readonly id: string;
  readonly scope: "instance" | "project";
  readonly projectId: string | null;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
}

/** A file uploaded through the attachment service of the ticket. */
export interface AcceptanceAsset {
  /** Name used to refer to the asset in questions and checks. */
  readonly fileName: string;
  readonly ticketKey: string;
  readonly uploadedBy: string;
  readonly bytes: Buffer;
  /** Whether the uploader releases the text for the search. */
  readonly isReleased: boolean;
}

/** A source named by its stable reference: ticket key, page title or asset file name. */
export interface ExpectedSource {
  readonly sourceType: "ticket" | "wiki_page" | "ticket_asset";
  readonly reference: string;
}

/** How a question relates to the words of its source. */
export type QuestionForm =
  "literal" | "paraphrase" | "crossLanguage" | "ticketKey" | "asset";

/** One question of the fixed question set. */
export interface AcceptanceQuestion {
  readonly id: string;
  readonly language: "de" | "en";
  readonly form: QuestionForm;
  readonly reader: string;
  readonly question: string;
  /** A hit is any of these among the first five sections. */
  readonly expected: readonly ExpectedSource[];
  /** Further sources that answer the question; they count for the precision. */
  readonly alsoRelevant: readonly ExpectedSource[];
}

/** Departments of the acceptance. */
export const DEPARTMENTS = {
  development: {
    id: "d5850000-0000-4000-8000-000000000001",
    name: "Entwicklung",
  },
  sales: { id: "d5850000-0000-4000-8000-000000000002", name: "Vertrieb" },
  security: { id: "d5850000-0000-4000-8000-000000000003", name: "Sicherheit" },
} as const;

/** Department-bound roles: one may change tickets, the other may only read. */
export const ROLES = {
  writer: {
    id: "rag-acceptance-writer",
    name: "Abnahme Schreiben",
    permissions: ["write"],
  },
  reader: {
    id: "rag-acceptance-reader",
    name: "Abnahme Lesen",
    permissions: [],
  },
} as const;

/** Projects of the acceptance, each bound to one department. */
export const PROJECTS = {
  platform: {
    id: "b5850000-0000-4000-8000-000000000001",
    name: "Plattform",
    departmentId: DEPARTMENTS.development.id,
  },
  sales: {
    id: "b5850000-0000-4000-8000-000000000002",
    name: "Vertrieb",
    departmentId: DEPARTMENTS.sales.id,
  },
} as const;

/** Persons with different rights. */
export const PERSONS = {
  alice: {
    id: "a5850000-0000-4000-8000-000000000001",
    username: "rag-alice",
    displayName: "Alice Abnahme",
    roleId: ROLES.writer.id,
    isAdmin: false,
    departmentIds: [DEPARTMENTS.development.id, DEPARTMENTS.security.id],
    purpose:
      "Writes in Plattform and also sees its tickets of the department Sicherheit.",
  },
  bob: {
    id: "a5850000-0000-4000-8000-000000000002",
    username: "rag-bob",
    displayName: "Bob Abnahme",
    roleId: ROLES.writer.id,
    isAdmin: false,
    departmentIds: [DEPARTMENTS.sales.id],
    purpose: "Writes in Vertrieb and must see nothing of Plattform.",
  },
  carla: {
    id: "a5850000-0000-4000-8000-000000000003",
    username: "rag-carla",
    displayName: "Carla Abnahme",
    roleId: ROLES.reader.id,
    isAdmin: false,
    departmentIds: [DEPARTMENTS.development.id],
    purpose:
      "Only reads Plattform and must not see tickets of the department Sicherheit.",
  },
  admin: {
    id: "a5850000-0000-4000-8000-000000000004",
    username: "rag-admin",
    displayName: "Admin Abnahme",
    roleId: "role-administration",
    isAdmin: true,
    departmentIds: [],
    purpose: "Archives tickets and projects.",
  },
} as const satisfies Record<string, AcceptancePerson>;

const ALICE = PERSONS.alice.id;
const BOB = PERSONS.bob.id;

/** Tickets of both projects; RAG-3 carries the department Sicherheit. */
export const TICKETS: readonly AcceptanceTicket[] = [
  {
    id: "c5850000-0000-4000-8000-000000000001",
    key: "RAG-1",
    number: 1,
    projectId: PROJECTS.platform.id,
    title: "Session refresh fails with 401 after password change",
    description:
      "After a password change the refresh token is revoked. The web client keeps the old token, so every refresh request answers 401 Unauthorized until the person signs in again.\n\nWorkaround: sign out and sign in again.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000002",
    key: "RAG-2",
    number: 2,
    projectId: PROJECTS.platform.id,
    title: "Arbeitszeiten monatlich als CSV exportieren",
    description:
      "Der Monatsexport der Zeiterfassung schreibt je Buchung eine CSV-Zeile mit Person, Tag und Stunden. Das Trennzeichen ist ein Semikolon, damit Excel die Datei direkt öffnet.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000003",
    key: "RAG-3",
    number: 3,
    projectId: PROJECTS.platform.id,
    title: "Rotate the signing keys of session tokens",
    description:
      "The signing keys of session tokens are rotated every 90 days. An old key stays valid for one more refresh so that open sessions survive the rotation.",
    departmentIds: [DEPARTMENTS.security.id],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000004",
    key: "RAG-4",
    number: 4,
    projectId: PROJECTS.platform.id,
    title: "Nächtliche Datensicherung der Datenbank",
    description:
      "Jede Nacht um 2 Uhr läuft eine Basissicherung, das WAL-Archiv sichert alle Änderungen dazwischen. Eine Wiederherstellung auf einen Zeitpunkt dauert für 20 GB etwa 15 Minuten.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000005",
    key: "RAG-5",
    number: 5,
    projectId: PROJECTS.platform.id,
    title: "Upload limit for ticket attachments",
    description:
      "Ticket attachments may be up to 25 MB; images and videos follow the media limit of the wiki settings. Larger files are refused while they stream in.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000006",
    key: "RAG-6",
    number: 6,
    projectId: PROJECTS.platform.id,
    title: "E-Mail-Benachrichtigungen bündeln",
    description:
      "Statt jeder einzelnen Änderung erhält eine Person höchstens eine Sammelmail pro Stunde mit allen Änderungen an beobachteten Tickets.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000007",
    key: "RAG-7",
    number: 7,
    projectId: PROJECTS.platform.id,
    title: "Board columns lose their colors in dark mode",
    description:
      "In dark mode the status columns of the board fall back to grey. The column color tokens need a value for the dark palette.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000008",
    key: "RAG-8",
    number: 8,
    projectId: PROJECTS.platform.id,
    title: "Suche findet Wörter mit Umlauten nicht",
    description:
      "Wer in der Suche „Prüfung“ eingibt, findet keine Seiten mit „Pruefung“. Umlaute und ihre Umschreibung sollen gleich behandelt werden.",
    departmentIds: [],
    createdBy: ALICE,
  },
  {
    id: "c5850000-0000-4000-8000-000000000011",
    key: "VK-1",
    number: 1,
    projectId: PROJECTS.sales.id,
    title: "Kunde erhält Rechnungen doppelt",
    description:
      "Ein Kunde meldet, dass jede Rechnung zweimal per E-Mail ankommt. Ursache ist ein doppelt angelegter Empfänger im Kundenkonto.",
    departmentIds: [],
    createdBy: BOB,
  },
  {
    id: "c5850000-0000-4000-8000-000000000012",
    key: "VK-2",
    number: 2,
    projectId: PROJECTS.sales.id,
    title: "Quote template for enterprise customers",
    description:
      "Enterprise quotes use the template with volume discount, a 30-day validity and the signature block of the sales lead.",
    departmentIds: [],
    createdBy: BOB,
  },
  {
    id: "c5850000-0000-4000-8000-000000000013",
    key: "VK-3",
    number: 3,
    projectId: PROJECTS.sales.id,
    title: "Customer cannot refresh the session after a password change",
    description:
      "A customer reports that the session refresh answers 401 after a password change. Sales refers the customer to the platform team.",
    departmentIds: [],
    createdBy: BOB,
  },
];

/** Instance pages everybody reads and one project page per project. */
export const PAGES: readonly AcceptancePage[] = [
  {
    id: "e5850000-0000-4000-8000-000000000001",
    scope: "instance",
    projectId: null,
    authorId: ALICE,
    title: "Anmeldung und Sitzungen",
    content:
      "## Passwort ändern\n\nNach einer Passwortänderung beendet Pages alle Sitzungen; die Person meldet sich neu an.\n\n## Token erneuern\n\nDer Client erneuert die Sitzung mit dem Refresh-Token, bevor sie abläuft.",
  },
  {
    id: "e5850000-0000-4000-8000-000000000002",
    scope: "instance",
    projectId: null,
    authorId: ALICE,
    title: "Release checklist",
    content:
      "## Before the release\n\nFreeze the main branch, run the database migrations on a copy of production and write the release notes.\n\n## After the release\n\nWatch the error log for one hour and announce the version in the team channel.",
  },
  {
    id: "e5850000-0000-4000-8000-000000000003",
    scope: "project",
    projectId: PROJECTS.platform.id,
    authorId: ALICE,
    title: "Betriebshandbuch Wiederherstellung",
    content:
      "## Backup einspielen\n\nDie Wiederherstellung startet mit der letzten Basissicherung; danach spielt der Server das WAL-Archiv bis zum gewünschten Zeitpunkt ein.\n\n## Nach der Wiederherstellung\n\nPrüfe die Anzahl der Zeilen je Tabelle und starte Pages erst danach.",
  },
  {
    id: "e5850000-0000-4000-8000-000000000004",
    scope: "project",
    projectId: PROJECTS.sales.id,
    authorId: BOB,
    title: "Vertriebsleitfaden",
    content:
      "Meldet ein Kunde doppelte Rechnungen, prüft der Vertrieb zuerst die Empfänger im Kundenkonto. Angebote für Großkunden nutzen die Vorlage mit Mengenrabatt.",
  },
];

/** The smallest valid PNG: one transparent pixel. */
const ONE_PIXEL_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

/** Assets uploaded through the attachment service; one is never released, one is no text. */
export const ASSETS: readonly AcceptanceAsset[] = [
  {
    fileName: "refresh-trace.log",
    ticketKey: "RAG-1",
    uploadedBy: ALICE,
    bytes: Buffer.from(
      "POST /session/refresh 401 Unauthorized\nreason: refresh token revoked after password change\nclient kept the old refresh token\n",
      "utf8",
    ),
    isReleased: true,
  },
  {
    fileName: "restore-protokoll.txt",
    ticketKey: "RAG-4",
    uploadedBy: ALICE,
    bytes: Buffer.from(
      "Wiederherstellung am 3. März: Basissicherung von 02:00 eingespielt, WAL bis 09:41 nachgefahren.\nDauer der Wiederherstellung: 14 Minuten, keine fehlenden Zeilen.\n",
      "utf8",
    ),
    isReleased: true,
  },
  {
    fileName: "upload-ausnahmen.txt",
    ticketKey: "RAG-5",
    uploadedBy: ALICE,
    bytes: Buffer.from(
      "Interne Notiz: geheime Ausnahme vom Grenzwert für das Marketing-Team.\n",
      "utf8",
    ),
    isReleased: false,
  },
  {
    fileName: "board-dark.png",
    ticketKey: "RAG-7",
    uploadedBy: ALICE,
    bytes: ONE_PIXEL_PNG,
    isReleased: true,
  },
  {
    fileName: "kundenmail.txt",
    ticketKey: "VK-1",
    uploadedBy: BOB,
    bytes: Buffer.from(
      "Sehr geehrte Damen und Herren, wir erhalten jede Rechnung doppelt. Bitte prüfen Sie unseren Empfänger.\n",
      "utf8",
    ),
    isReleased: true,
  },
];

function ticket(reference: string): ExpectedSource {
  return { sourceType: "ticket", reference };
}

function page(reference: string): ExpectedSource {
  return { sourceType: "wiki_page", reference };
}

function asset(reference: string): ExpectedSource {
  return { sourceType: "ticket_asset", reference };
}

interface QuestionInput {
  readonly language: "de" | "en";
  readonly form: QuestionForm;
  readonly reader?: string;
  readonly question: string;
  readonly expected: readonly ExpectedSource[];
  readonly alsoRelevant?: readonly ExpectedSource[];
}

/** The fixed question set: twelve English and twelve German questions. */
export const QUESTIONS: readonly AcceptanceQuestion[] = (
  [
    {
      language: "en",
      form: "literal",
      question: "session refresh 401 password change",
      expected: [ticket("RAG-1")],
      alsoRelevant: [
        asset("refresh-trace.log"),
        page("Anmeldung und Sitzungen"),
      ],
    },
    {
      language: "en",
      form: "paraphrase",
      question:
        "Why do users get a 401 error after they change their password?",
      expected: [ticket("RAG-1")],
      alsoRelevant: [
        asset("refresh-trace.log"),
        page("Anmeldung und Sitzungen"),
      ],
    },
    {
      language: "en",
      form: "paraphrase",
      question: "How often are the keys that sign session tokens replaced?",
      expected: [ticket("RAG-3")],
    },
    {
      language: "en",
      form: "paraphrase",
      question: "What is the maximum size of a file attached to a ticket?",
      expected: [ticket("RAG-5")],
    },
    {
      language: "en",
      form: "literal",
      question: "board dark mode colors",
      expected: [ticket("RAG-7")],
    },
    {
      language: "en",
      form: "paraphrase",
      question: "What do we have to do before shipping a new version?",
      expected: [page("Release checklist")],
    },
    {
      language: "en",
      form: "ticketKey",
      question: "What is the status of RAG-6?",
      expected: [ticket("RAG-6")],
    },
    {
      language: "en",
      form: "asset",
      question: "Which log shows that the refresh token was revoked?",
      expected: [asset("refresh-trace.log")],
      alsoRelevant: [ticket("RAG-1")],
    },
    {
      language: "en",
      form: "crossLanguage",
      question: "How long does a point-in-time restore of the database take?",
      expected: [ticket("RAG-4")],
      alsoRelevant: [
        page("Betriebshandbuch Wiederherstellung"),
        asset("restore-protokoll.txt"),
      ],
    },
    {
      language: "en",
      form: "literal",
      reader: PERSONS.bob.id,
      question: "enterprise quote template validity",
      expected: [ticket("VK-2")],
      alsoRelevant: [page("Vertriebsleitfaden")],
    },
    {
      language: "en",
      form: "crossLanguage",
      reader: PERSONS.bob.id,
      question: "Why does a customer receive every invoice twice?",
      expected: [ticket("VK-1")],
      alsoRelevant: [page("Vertriebsleitfaden"), asset("kundenmail.txt")],
    },
    {
      language: "en",
      form: "crossLanguage",
      question: "Searching for words with umlauts finds nothing",
      expected: [ticket("RAG-8")],
    },
    {
      language: "de",
      form: "literal",
      question: "CSV Export Zeiterfassung",
      expected: [ticket("RAG-2")],
    },
    {
      language: "de",
      form: "paraphrase",
      question:
        "Wie bekomme ich meine Arbeitsstunden in eine Tabelle für Excel?",
      expected: [ticket("RAG-2")],
    },
    {
      language: "de",
      form: "paraphrase",
      question: "Um wie viel Uhr läuft die nächtliche Sicherung?",
      expected: [ticket("RAG-4")],
      alsoRelevant: [page("Betriebshandbuch Wiederherstellung")],
    },
    {
      language: "de",
      form: "paraphrase",
      question:
        "Was passiert mit meinen Sitzungen, wenn ich mein Passwort ändere?",
      expected: [page("Anmeldung und Sitzungen")],
      alsoRelevant: [ticket("RAG-1")],
    },
    {
      language: "de",
      form: "paraphrase",
      question: "Wie spiele ich ein Backup wieder ein?",
      expected: [page("Betriebshandbuch Wiederherstellung")],
      alsoRelevant: [ticket("RAG-4"), asset("restore-protokoll.txt")],
    },
    {
      language: "de",
      form: "asset",
      question: "Wie lange hat die letzte Wiederherstellung gedauert?",
      expected: [asset("restore-protokoll.txt")],
      alsoRelevant: [
        ticket("RAG-4"),
        page("Betriebshandbuch Wiederherstellung"),
      ],
    },
    {
      language: "de",
      form: "paraphrase",
      question: "Bekomme ich für jede Änderung eine eigene E-Mail?",
      expected: [ticket("RAG-6")],
    },
    {
      language: "de",
      form: "crossLanguage",
      question: "Warum fehlen die Farben der Spalten im dunklen Modus?",
      expected: [ticket("RAG-7")],
    },
    {
      language: "de",
      form: "crossLanguage",
      question: "Wie oft werden die Signaturschlüssel der Sitzungen getauscht?",
      expected: [ticket("RAG-3")],
    },
    {
      language: "de",
      form: "ticketKey",
      question: "Stand von rag-2",
      expected: [ticket("RAG-2")],
    },
    {
      language: "de",
      form: "literal",
      reader: PERSONS.bob.id,
      question: "doppelte Rechnungen Empfänger Kundenkonto",
      expected: [page("Vertriebsleitfaden"), ticket("VK-1")],
      alsoRelevant: [asset("kundenmail.txt")],
    },
    {
      language: "de",
      form: "paraphrase",
      reader: PERSONS.bob.id,
      question: "Welche Vorlage nutze ich für Angebote an Großkunden?",
      expected: [page("Vertriebsleitfaden"), ticket("VK-2")],
    },
  ] satisfies readonly QuestionInput[]
).map((input: QuestionInput, index): AcceptanceQuestion => ({
  id: `q${String(index + 1).padStart(2, "0")}`,
  language: input.language,
  form: input.form,
  reader: input.reader ?? ALICE,
  question: input.question,
  expected: input.expected,
  alsoRelevant: input.alsoRelevant ?? [],
}));
