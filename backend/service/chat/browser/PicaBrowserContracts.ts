import { z } from "zod";

import {
  PICA_BROWSER_DEVICES,
  PICA_BROWSER_VIEWPORT_LIMITS,
  picaBrowserSessionName,
} from "@/definition/PicaBrowser";

const browserId = z.string().uuid();
const ref = z.string().regex(/^e\d{1,5}$/u);
const coordinate = z.number().int().min(0).max(5000);
const dialogAnswer = z.enum(["accept", "dismiss"]);

/** A place on the page: an element reference of the last observation, or viewport coordinates of its screenshot. */
const point = z
  .object({
    ref: ref.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
  })
  .strict();

const formField = z
  .object({
    ref,
    text: z.string().max(2000).optional(),
    option: z.string().max(300).optional(),
    checked: z.boolean().optional(),
  })
  .strict();

/**
 * The inputs of the operator browser tools.
 *
 * @remarks
 * No tool accepts an actor, a script, a header, a cookie or a credential. The
 * model names a place by the reference of its last observation or by the
 * viewport coordinates of its screenshot.
 */
export const PICA_BROWSER_SCHEMAS = {
  browser_open: z
    .object({
      task: z.string().min(1).max(500),
      url: z.string().max(2000).optional(),
      profile: picaBrowserSessionName.optional(),
      device: z.enum(PICA_BROWSER_DEVICES).optional(),
    })
    .strict(),
  browser_observe: z
    .object({
      browserId,
      detail: z.enum(["screen", "full"]).optional(),
      fullPage: z.boolean().optional(),
      annotate: z.boolean().optional(),
    })
    .strict(),
  browser_navigate: z
    .object({
      browserId,
      action: z.enum(["goto", "back", "forward", "reload"]),
      url: z.string().max(2000).optional(),
    })
    .strict(),
  browser_click: z
    .object({
      browserId,
      ...point.shape,
      double: z.boolean().optional(),
      button: z.enum(["left", "right"]).optional(),
      dialog: dialogAnswer.optional(),
    })
    .strict(),
  browser_hover: z.object({ browserId, ...point.shape }).strict(),
  browser_type: z
    .object({
      browserId,
      ref: ref.optional(),
      text: z.string().min(1).max(2000),
      clear: z.boolean().optional(),
      submit: z.boolean().optional(),
    })
    .strict(),
  browser_press: z
    .object({
      browserId,
      keys: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[A-Za-z0-9+-]+$/u),
      dialog: dialogAnswer.optional(),
    })
    .strict(),
  browser_scroll: z
    .object({
      browserId,
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().min(1).max(5000).optional(),
      ref: ref.optional(),
    })
    .strict(),
  browser_drag: z.object({ browserId, from: point, to: point }).strict(),
  browser_form: z
    .object({
      browserId,
      fields: z.array(formField).min(1).max(30),
      submit: z.union([ref, z.literal("enter")]).optional(),
    })
    .strict(),
  browser_upload: z
    .object({
      browserId,
      ref,
      file: z.string().min(1).max(240).optional(),
      download: z.string().uuid().optional(),
    })
    .strict(),
  browser_tabs: z
    .object({
      browserId,
      action: z.enum(["list", "open", "switch", "close"]),
      tab: z.number().int().min(0).max(20).optional(),
      url: z.string().max(2000).optional(),
    })
    .strict(),
  browser_viewport: z
    .object({
      browserId,
      device: z.enum(PICA_BROWSER_DEVICES).optional(),
      width: z
        .number()
        .int()
        .min(PICA_BROWSER_VIEWPORT_LIMITS.minimumWidth)
        .max(PICA_BROWSER_VIEWPORT_LIMITS.maximumWidth)
        .optional(),
      height: z
        .number()
        .int()
        .min(PICA_BROWSER_VIEWPORT_LIMITS.minimumHeight)
        .max(PICA_BROWSER_VIEWPORT_LIMITS.maximumHeight)
        .optional(),
    })
    .strict(),
  browser_wait: z
    .object({
      browserId,
      seconds: z.number().min(0.1).max(10).optional(),
      text: z.string().min(1).max(200).optional(),
    })
    .strict(),
  browser_handover: z
    .object({ browserId, reason: z.string().min(1).max(300) })
    .strict(),
  browser_downloads: z
    .object({ browserId, id: z.string().uuid().optional() })
    .strict(),
  browser_profiles: z.object({}).strict(),
  browser_close: z.object({ browserId }).strict(),
} as const;

export type PicaBrowserTool = keyof typeof PICA_BROWSER_SCHEMAS;
export type PicaBrowserPoint = z.infer<typeof point>;
export type PicaBrowserFormField = z.infer<typeof formField>;

/** Limits employee browsers to visual actions without transfers or signing in as another account. */
export function isAgentBrowserTool(tool: PicaBrowserTool): boolean {
  return (
    tool !== "browser_upload" &&
    tool !== "browser_downloads" &&
    tool !== "browser_handover"
  );
}

/** Narrows names before the registry dispatches an operator browser tool. */
export function isPicaBrowserTool(name: string): name is PicaBrowserTool {
  return Object.hasOwn(PICA_BROWSER_SCHEMAS, name);
}

/** One screenshot a tool result hands to the model as image data. */
export interface PicaBrowserImage {
  readonly mimeType: "image/jpeg";
  /** Base64 of the image bytes. */
  readonly data: string;
}

/** What one operator browser call returns before Pages turns it into a tool outcome. */
export interface PicaBrowserReply {
  /** The bounded, credential-filtered JSON text of the result. */
  readonly text: string;
  readonly images: readonly PicaBrowserImage[];
}
