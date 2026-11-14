import { z } from "zod";

/** How the operator browser of Pica is controlled right now. */
export const PICA_BROWSER_STATES = [
  "running",
  "paused",
  "takeover",
  "stopped",
] as const;

/** `running`: Pica acts; `paused`: Pica waits; `takeover`: an administrator drives; `stopped`: closed for good. */
export type PicaBrowserState = (typeof PICA_BROWSER_STATES)[number];

/** Viewport presets of the operator browser. */
export const PICA_BROWSER_DEVICES = ["desktop", "mobile"] as const;

export type PicaBrowserDevice = (typeof PICA_BROWSER_DEVICES)[number];

/** Pixel limits of a custom viewport. */
export const PICA_BROWSER_VIEWPORT_LIMITS = {
  minimumWidth: 320,
  maximumWidth: 2560,
  minimumHeight: 320,
  maximumHeight: 1600,
} as const;

const SESSION_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,59}$/u;

/** The name of a saved browser session; no path, no separators. */
export const picaBrowserSessionName = z.string().regex(SESSION_NAME);

const actionSchema = z
  .object({
    at: z.string(),
    actor: z.enum(["pica", "admin"]),
    summary: z.string().max(300),
    status: z.enum(["completed", "failed"]),
  })
  .strict();

const tabSchema = z
  .object({
    index: z.number().int().min(0),
    url: z.string(),
    title: z.string(),
    isActive: z.boolean(),
  })
  .strict();

const downloadSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string(),
    contentType: z.string(),
    size: z.number().int().min(0),
    at: z.string(),
  })
  .strict();

const savedSessionSchema = z
  .object({
    name: z.string(),
    origins: z.array(z.string()),
    savedAt: z.string(),
  })
  .strict();

/** What the chat shows of one running operator browser; never a credential. */
export const picaBrowserViewSchema = z
  .object({
    browserId: z.string().uuid(),
    isAgent: z.boolean().optional(),
    ownerName: z.string().optional(),
    task: z.string(),
    state: z.enum(PICA_BROWSER_STATES),
    url: z.string(),
    title: z.string(),
    device: z.enum(PICA_BROWSER_DEVICES),
    width: z.number().int(),
    height: z.number().int(),
    frameVersion: z.number().int().min(0),
    tabs: z.array(tabSchema),
    actions: z.array(actionSchema),
    downloads: z.array(downloadSchema),
    handoverReason: z.string().nullable(),
    profile: z.string().nullable(),
    areLocalWritesApproved: z.boolean(),
    updatedAt: z.string(),
  })
  .strict();

export type PicaBrowserView = z.infer<typeof picaBrowserViewSchema>;
export type PicaBrowserAction = z.infer<typeof actionSchema>;
export type PicaBrowserTab = z.infer<typeof tabSchema>;
export type PicaBrowserDownload = z.infer<typeof downloadSchema>;

/** The list answer of the live interface: the browsers and the saved sessions of the person. */
export const picaBrowserOverviewSchema = z
  .object({
    browsers: z.array(picaBrowserViewSchema),
    savedSessions: z.array(savedSessionSchema),
  })
  .strict();

export type PicaBrowserOverview = z.infer<typeof picaBrowserOverviewSchema>;

/** One input of an administrator who took over the browser. */
export const picaBrowserInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("click"),
      x: z.number().min(0).max(5000),
      y: z.number().min(0).max(5000),
      clicks: z.number().int().min(1).max(2).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      x: z.number().min(0).max(5000),
      y: z.number().min(0).max(5000),
      deltaX: z.number().min(-5000).max(5000),
      deltaY: z.number().min(-5000).max(5000),
    })
    .strict(),
  z
    .object({ type: z.literal("text"), text: z.string().min(1).max(500) })
    .strict(),
  z.object({ type: z.literal("key"), key: z.string().min(1).max(60) }).strict(),
  z
    .object({ type: z.literal("navigate"), url: z.string().min(1).max(2000) })
    .strict(),
  z
    .object({
      type: z.literal("history"),
      direction: z.enum(["back", "forward", "reload"]),
    })
    .strict(),
]);

export type PicaBrowserInput = z.infer<typeof picaBrowserInputSchema>;

/** A control the person gives from the chat; every one is checked on the server. */
export const picaBrowserCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("pause") }).strict(),
  z.object({ command: z.literal("resume") }).strict(),
  z.object({ command: z.literal("stop") }).strict(),
  z.object({ command: z.literal("takeover") }).strict(),
  z.object({ command: z.literal("handback") }).strict(),
  z
    .object({ command: z.literal("approveLocalWrites"), approved: z.boolean() })
    .strict(),
  z
    .object({ command: z.literal("saveSession"), name: picaBrowserSessionName })
    .strict(),
  z
    .object({
      command: z.literal("deleteSession"),
      name: picaBrowserSessionName,
    })
    .strict(),
  z
    .object({ command: z.literal("input"), input: picaBrowserInputSchema })
    .strict(),
]);

export type PicaBrowserCommand = z.infer<typeof picaBrowserCommandSchema>;

/** Reads the answer of the live interface; anything unexpected is `null`. */
export function readPicaBrowserOverview(
  value: unknown,
): PicaBrowserOverview | null {
  const parsed = picaBrowserOverviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Reads one browser view; anything unexpected is `null`. */
export function readPicaBrowserView(value: unknown): PicaBrowserView | null {
  const parsed = picaBrowserViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
