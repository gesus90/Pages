import { randomUUID } from "node:crypto";

import { z } from "zod";

import { drawChartPng } from "./chart-png";
import { PagesClient } from "./pages-client";

import type { ChartOptions } from "./chart-png";

/** Password of the synthetic administrator of the isolated instance. */
const ADMIN_PASSWORD = "browser-admin-pass-1";

/** Password the synthetic reader sets after the first sign-in. */
const READER_PASSWORD = "browser-reader-pass-1";

/** An image of a fixture ticket. */
export interface SeedImage {
  readonly attachmentId: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** Address the description embeds. */
  readonly path: string;
}

/** A ticket of the fixtures with the images of its description in order. */
export interface SeedTicket {
  readonly id: string;
  readonly key: string;
  readonly images: readonly SeedImage[];
}

/** Everything the browser tests need to know about the seeded instance. */
export interface SeedData {
  /** One image. */
  readonly single: SeedTicket;
  /** Five images of different shapes in a long text. */
  readonly gallery: SeedTicket;
  /** An image inside a link, a plain image, and ordinary links. */
  readonly linked: SeedTicket;
  /** Three images; the second attachment was deleted. */
  readonly missing: SeedTicket;
  /** Three images; the second belongs to a ticket the reader cannot see. */
  readonly hidden: SeedTicket;
  /** One image, for the explicit editing of the description. */
  readonly editing: SeedTicket;
  readonly hiddenAttachmentId: string;
  readonly hiddenTicketKey: string;
}

interface SeedSession {
  readonly admin: PagesClient;
  readonly reader: PagesClient;
}

const LANDSCAPE: ChartOptions = {
  height: 900,
  marks: 1,
  palette: {
    accent: [250, 204, 21],
    background: [219, 234, 254],
    line: [30, 64, 175],
  },
  width: 1600,
};
const PORTRAIT: ChartOptions = {
  height: 1600,
  marks: 2,
  palette: {
    accent: [244, 114, 182],
    background: [220, 252, 231],
    line: [21, 128, 61],
  },
  width: 700,
};
const SQUARE: ChartOptions = {
  height: 900,
  marks: 3,
  palette: {
    accent: [56, 189, 248],
    background: [254, 226, 226],
    line: [153, 27, 27],
  },
  width: 900,
};
const LARGE: ChartOptions = {
  height: 2700,
  marks: 4,
  palette: {
    accent: [74, 222, 128],
    background: [243, 232, 255],
    line: [107, 33, 168],
  },
  width: 4800,
};
const PANORAMA: ChartOptions = {
  height: 400,
  marks: 5,
  palette: {
    accent: [251, 146, 60],
    background: [254, 249, 195],
    line: [133, 77, 14],
  },
  width: 2400,
};

const FILLER =
  "This paragraph only makes the description long enough to scroll. It states nothing about the images and changes no behavior.";

const attachmentAnswer = z.object({
  attachment: z.object({ id: z.string() }),
});
const panelAnswer = z.object({
  selection: z.object({
    selectedItem: z.object({
      id: z.string(),
      title: z.string(),
      updatedAt: z.string(),
    }),
  }),
});

/** The language cookie of the administrator is taken before the setup runs. */
async function createLanguageCookie(origin: string): Promise<string> {
  const client = new PagesClient(origin);
  const answer = await client.postForm("/set-language", {
    language: "en",
    redirectTo: "/",
  });
  const cookie = answer.setCookies.find((entry) =>
    entry.startsWith("pages_language="),
  );

  if (!cookie) {
    throw new Error("The server set no language cookie.");
  }

  return cookie.split(";")[0] ?? "";
}

/**
 * Completes the setup wizard and returns the signed-in administrator.
 *
 * @param origin - Address of the instance.
 * @param setupToken - One-time secret of the wizard.
 * @param databasePath - Absolute path of the new database.
 * @returns A client with the administrator's session.
 */
export async function completeSetup(
  origin: string,
  setupToken: string,
  databasePath: string,
): Promise<PagesClient> {
  const admin = new PagesClient(origin, await createLanguageCookie(origin));
  const answer = await admin.postForm("/setup", {
    companyName: "Browser Test Company",
    databasePath,
    intent: "complete",
    password: ADMIN_PASSWORD,
    token: setupToken,
    username: "admin",
  });

  if (answer.status !== 302 || admin.sessionToken === null) {
    throw new Error(`The setup answered ${answer.status} and set no session.`);
  }

  return admin;
}

async function saveSettings(client: PagesClient, theme: string): Promise<void> {
  const answer = await client.postForm("/settings/profile", {
    dateFormat: "YYYY-MM-DD",
    intent: "update-settings",
    language: "en",
    "notification.assignments": "off",
    "notification.desktop": "off",
    "notification.dueDates": "off",
    "notification.email": "off",
    "notification.mentions": "off",
    "notification.weeklySummary": "off",
    theme,
    timezone: "UTC",
    weekStart: "monday",
  });

  if (answer.status >= 400) {
    throw new Error(`The settings were refused with ${answer.status}.`);
  }
}

/** Creates the reader: a role that may only read, bound to departments. */
async function createReader(
  origin: string,
  admin: PagesClient,
): Promise<PagesClient> {
  const roleId = randomUUID();
  const role = await admin.postForm("/users", {
    departmentBound: "true",
    entityId: roleId,
    intent: "save-role",
    name: "Browser reader",
    rank: "2",
  });
  const user = await admin.postForm("/users", {
    firstName: "Rita",
    intent: "create-user",
    lastName: "Reader",
    role: roleId,
    username: "reader",
  });
  const temporary =
    /temporaryPassword\W+([A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4})/u.exec(
      user.text,
    )?.[1];

  if (role.status !== 200 || !temporary) {
    throw new Error("The reader account could not be created.");
  }

  const reader = new PagesClient(origin);

  await reader.postForm("/login", { password: temporary, username: "reader" });
  await reader.postForm("/change-password", {
    currentPassword: temporary,
    newPassword: READER_PASSWORD,
    passwordConfirmation: READER_PASSWORD,
  });
  await saveSettings(reader, "system");

  return reader;
}

async function listProjectIds(admin: PagesClient): Promise<readonly string[]> {
  const page = await admin.getText("/projekte");

  return [...page.matchAll(/href="\/projekte\/([0-9a-f-]{36})"/gu)].map(
    (match) => match[1] ?? "",
  );
}

/** Creates a project and returns its identifier, read from the project list. */
async function createProject(
  admin: PagesClient,
  name: string,
  departmentId: string | null,
): Promise<string> {
  const before = await listProjectIds(admin);
  const answer = await admin.postForm("/projekte", {
    ...(departmentId ? { departmentIds: departmentId } : {}),
    description: "",
    intent: "create-project",
    name,
    status: "active",
  });
  const created = (await listProjectIds(admin)).find(
    (id) => !before.includes(id),
  );

  if (answer.status !== 200 || !created) {
    throw new Error(`Project ${name} was refused with ${answer.status}.`);
  }

  return created;
}

async function createTicket(
  admin: PagesClient,
  projectId: string,
  ticket: { readonly key: string; readonly title: string },
): Promise<string> {
  const answer = await admin.postForm("/aufgaben", {
    intent: "create-task",
    projectId,
    statusId: "status-todo",
    title: ticket.title,
    type: "task",
  });

  if (answer.status !== 200) {
    throw new Error(
      `Ticket ${ticket.title} was refused with ${answer.status}.`,
    );
  }

  const panel = await admin.getJson(
    `/aufgaben-api/panel/${ticket.key}`,
    panelAnswer,
  );

  // The key follows the order of creation; a mismatch would mix up fixtures.
  if (panel.selection.selectedItem.title !== ticket.title) {
    throw new Error(`${ticket.key} is not the ticket "${ticket.title}".`);
  }

  return panel.selection.selectedItem.id;
}

async function uploadImage(
  admin: PagesClient,
  ticketId: string,
  alt: string,
  chart: ChartOptions,
): Promise<SeedImage> {
  const fileName = `${alt.toLowerCase().replace(/\W+/gu, "-")}.png`;
  const answer = await admin.putFile(
    `/aufgaben-api/attachments?ticket=${encodeURIComponent(ticketId)}&name=${encodeURIComponent(fileName)}`,
    drawChartPng(chart),
  );
  const parsed = attachmentAnswer.parse(answer.json);

  return {
    alt,
    attachmentId: parsed.attachment.id,
    height: chart.height,
    path: `/aufgaben/attachments/${parsed.attachment.id}`,
    width: chart.width,
  };
}

async function saveDescription(
  admin: PagesClient,
  key: string,
  ticketId: string,
  description: string,
): Promise<void> {
  const panel = await admin.getJson(`/aufgaben-api/panel/${key}`, panelAnswer);
  const base = {
    description: "",
    updatedAt: panel.selection.selectedItem.updatedAt,
  };
  const answer = await admin.postJson(`/ticket-api/drafts/${ticketId}`, {
    base,
    draft: { description, updatedAt: base.updatedAt },
    sequence: 1,
    streamId: randomUUID(),
  });

  if (answer.status !== 200) {
    throw new Error(
      `The description of ${key} was refused with ${answer.status}.`,
    );
  }
}

function embed(image: SeedImage): string {
  return `![${image.alt}](${image.path})`;
}

function filler(paragraphs: number): string {
  return Array.from(
    { length: paragraphs },
    (_, index) => `${FILLER} (${index + 1})`,
  ).join("\n\n");
}

/** The project the next tickets are created in. */
interface ProjectContext {
  readonly admin: PagesClient;
  readonly projectId: string;
}

interface TicketPlan {
  readonly key: string;
  readonly title: string;
}

async function uploadAll(
  context: ProjectContext,
  ticketId: string,
  charts: readonly (readonly [string, ChartOptions])[],
): Promise<SeedImage[]> {
  const images: SeedImage[] = [];

  for (const [alt, chart] of charts) {
    images.push(await uploadImage(context.admin, ticketId, alt, chart));
  }

  return images;
}

async function seedSimple(
  context: ProjectContext,
  plan: TicketPlan,
  chart: ChartOptions,
): Promise<SeedTicket> {
  const id = await createTicket(context.admin, context.projectId, plan);
  const images = await uploadAll(context, id, [[plan.title, chart]]);

  await saveDescription(
    context.admin,
    plan.key,
    id,
    `Synthetic fixture ticket.\n\n${images.map(embed).join("\n\n")}`,
  );

  return { id, images, key: plan.key };
}

async function seedGallery(context: ProjectContext): Promise<SeedTicket> {
  const plan = { key: "VIEW-2", title: "Gallery with five images" };
  const id = await createTicket(context.admin, context.projectId, plan);
  const images = await uploadAll(context, id, [
    ["Landscape chart", LANDSCAPE],
    ["Portrait chart", PORTRAIT],
    ["Square chart", SQUARE],
    ["Large chart", LARGE],
    ["Panorama chart", PANORAMA],
  ]);
  const sections = images.map((image) => `${filler(3)}\n\n${embed(image)}`);

  await saveDescription(
    context.admin,
    plan.key,
    id,
    `${sections.join("\n\n")}\n\n${filler(4)}`,
  );

  return { id, images, key: plan.key };
}

async function seedLinked(context: ProjectContext): Promise<SeedTicket> {
  const plan = { key: "VIEW-3", title: "Linked image" };
  const id = await createTicket(context.admin, context.projectId, plan);
  const images = await uploadAll(context, id, [
    ["Linked chart", SQUARE],
    ["Plain chart", LANDSCAPE],
  ]);
  const [linked, plain] = images;

  if (!linked || !plain) {
    throw new Error("The linked fixture lost an image.");
  }

  await saveDescription(
    context.admin,
    plan.key,
    id,
    [
      "Synthetic fixture ticket.",
      `[${embed(linked)}](/aufgaben/VIEW-1)`,
      "[Ordinary link](/aufgaben/VIEW-1) and [external link](https://example.test/target).",
      embed(plain),
    ].join("\n\n"),
  );

  return { id, images, key: plan.key };
}

async function seedMissing(context: ProjectContext): Promise<SeedTicket> {
  const plan = { key: "VIEW-4", title: "Deleted attachment" };
  const id = await createTicket(context.admin, context.projectId, plan);
  const images = await uploadAll(context, id, [
    ["First chart", LANDSCAPE],
    ["Deleted chart", SQUARE],
    ["Last chart", PORTRAIT],
  ]);

  await saveDescription(
    context.admin,
    plan.key,
    id,
    images.map(embed).join("\n\n"),
  );
  await context.admin.postForm("/aufgaben", {
    attachmentId: images[1]?.attachmentId ?? "",
    intent: "remove-attachment",
  });

  return { id, images, key: plan.key };
}

async function seedHidden(
  context: ProjectContext,
  secret: SeedImage,
): Promise<SeedTicket> {
  const plan = { key: "VIEW-6", title: "Image of a hidden ticket" };
  const id = await createTicket(context.admin, context.projectId, plan);
  const [first, last] = await uploadAll(context, id, [
    ["Open chart", LANDSCAPE],
    ["Second open chart", PORTRAIT],
  ]);

  if (!first || !last) {
    throw new Error("The hidden-image fixture lost an image.");
  }

  const images = [first, secret, last];

  await saveDescription(
    context.admin,
    plan.key,
    id,
    images.map(embed).join("\n\n"),
  );

  return { id, images, key: plan.key };
}

async function seedSecret(
  admin: PagesClient,
): Promise<{ readonly image: SeedImage; readonly key: string }> {
  // The department exists only now: with departments in the catalog every new
  // project must name one, and the open project names none.
  const departmentId = randomUUID();

  await admin.postForm("/users", {
    entityId: departmentId,
    intent: "save-department",
    name: "Confidential",
  });

  const projectId = await createProject(admin, "Secret", departmentId);
  const plan = { key: "SECR-1", title: "Hidden ticket" };
  const id = await createTicket(admin, projectId, plan);
  const image = await uploadImage(admin, id, "Hidden chart", SQUARE);

  return { image, key: plan.key };
}

/**
 * Builds the fixtures: accounts, projects, tickets and images.
 *
 * @param admin - The signed-in administrator of a fresh instance.
 * @param origin - Address of the instance.
 * @returns The reader's client, the administrator's client and the seed data.
 */
export async function seedFixtures(
  admin: PagesClient,
  origin: string,
): Promise<SeedSession & { readonly seed: SeedData }> {
  await saveSettings(admin, "system");

  const reader = await createReader(origin, admin);
  const context = {
    admin,
    projectId: await createProject(admin, "Viewer", null),
  };
  const single = await seedSimple(
    context,
    { key: "VIEW-1", title: "Single image" },
    LANDSCAPE,
  );
  const gallery = await seedGallery(context);
  const linked = await seedLinked(context);
  const missing = await seedMissing(context);
  const editing = await seedSimple(
    context,
    { key: "VIEW-5", title: "Explicit editing" },
    LANDSCAPE,
  );
  const secret = await seedSecret(admin);
  const hidden = await seedHidden(context, secret.image);

  return {
    admin,
    reader,
    seed: {
      editing,
      gallery,
      hidden,
      hiddenAttachmentId: secret.image.attachmentId,
      hiddenTicketKey: secret.key,
      linked,
      missing,
      single,
    },
  };
}
