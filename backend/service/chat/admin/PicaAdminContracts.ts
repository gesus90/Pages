import { z } from "zod";

const filePath = z.string().min(1).max(240);
const sessionId = z.string().uuid();

/** Native admin tools accept no actor, OS command, script or credential parameters. */
export const PICA_ADMIN_SCHEMAS = {
  admin_browser_open: z
    .object({
      task: z.string().min(1).max(500),
      url: z.string().max(2000).nullable(),
      file: filePath.nullable(),
    })
    .strict(),
  admin_browser_action: z
    .object({
      browserId: sessionId,
      action: z.enum(["view", "click", "fill", "close"]),
      selector: z.string().max(300).nullable(),
      text: z.string().max(2000).nullable(),
    })
    .strict(),
  admin_files_find: z.object({ directory: z.string().max(240) }).strict(),
  admin_files_read: z.object({ path: filePath }).strict(),
  admin_files_edit: z
    .object({
      path: filePath,
      revision: z.string().uuid(),
      before: z.string().min(1).max(16_000),
      after: z.string().max(16_000),
    })
    .strict(),
} as const;

export type PicaAdminTool = keyof typeof PICA_ADMIN_SCHEMAS;
export type PicaBrowserOpen = z.infer<
  typeof PICA_ADMIN_SCHEMAS.admin_browser_open
>;
export type PicaBrowserAction = z.infer<
  typeof PICA_ADMIN_SCHEMAS.admin_browser_action
>;
export type PicaFileEdit = z.infer<typeof PICA_ADMIN_SCHEMAS.admin_files_edit>;

/** Stable safe refusal codes; raw browser, network and filesystem errors never leave the service. */
export class PicaAdminError extends Error {
  public constructor(code: string) {
    super(code);
    this.name = "PicaAdminError";
  }
}

/** Narrows names before either transport dispatches a privileged native tool. */
export function isPicaAdminTool(name: string): name is PicaAdminTool {
  return Object.hasOwn(PICA_ADMIN_SCHEMAS, name);
}
