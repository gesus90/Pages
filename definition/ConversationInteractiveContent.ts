/**
 * Contracts of the interactive attachments of conversation messages: a
 * glTF 2.0 binary model (`.glb`) that the chat shows in its own 3D viewer,
 * and a web export package of a game engine that the chat starts in an
 * isolated player frame. Shared by the server and the web chat.
 */

import { z } from "zod";

/** The type of a model Pages checked: a self-contained glTF 2.0 binary file. */
export const CONVERSATION_MODEL_MIME_TYPE = "model/gltf-binary";

/** The type of the manifest attachment of a checked web export package. */
export const CONVERSATION_WEB_PACKAGE_MIME_TYPE =
  "application/vnd.pages.web-package+json";

/** The file name that marks the manifest of a web export package. */
export const CONVERSATION_WEB_PACKAGE_MANIFEST_NAME = "pages-web-export.json";

/** Largest model the chat shows in its viewer, in bytes: 64 MB. */
export const CONVERSATION_MODEL_MAXIMUM_BYTES = 64 * 1024 * 1024;

/** Most files one web export package holds, the manifest not counted. */
export const CONVERSATION_WEB_PACKAGE_MAXIMUM_FILES = 8;

/** Largest file of a web export package, in bytes: 128 MB. */
export const CONVERSATION_WEB_PACKAGE_FILE_MAXIMUM_BYTES = 128 * 1024 * 1024;

/** Largest web export package, all files together, in bytes: 192 MB. */
export const CONVERSATION_WEB_PACKAGE_MAXIMUM_BYTES = 192 * 1024 * 1024;

/** Largest manifest of a web export package, in bytes. */
export const CONVERSATION_WEB_PACKAGE_MANIFEST_MAXIMUM_BYTES = 64 * 1024;

/** How long one start of a player may load the files of its package. */
export const CONVERSATION_WEB_PACKAGE_GRANT_MILLISECONDS = 30 * 60 * 1000;

/** One plain file name inside a package: no directory, no hidden file. */
const packageFileNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u)
  .refine((name) => !name.includes(".."));

/** One file a web export package lists with its size and checksum. */
const packageFileSchema = z
  .object({
    path: packageFileNameSchema,
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(CONVERSATION_WEB_PACKAGE_FILE_MAXIMUM_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

/**
 * The manifest `pages-web-export.json` of a Godot 4 web export.
 * @remarks
 * The first stage takes only the single-threaded build of the Compatibility
 * renderer (WebGL 2 and WebAssembly), which Godot offers from 4.3 on. The
 * package lists the engine script `<executable>.js`, the module
 * `<executable>.wasm`, the data `<executable>.pck`, optionally the audio
 * worklets and a PNG start image. The HTML page of the export is never part
 * of it: Pages writes the entry page of the player itself.
 */
export const conversationWebPackageManifestSchema = z
  .object({
    format: z.literal("pages-web-package"),
    version: z.literal(1),
    engine: z
      .object({
        name: z.literal("godot"),
        version: z
          .string()
          .regex(
            /^4\.(?:[3-9]|[1-9]\d)(?:\.\d{1,3})?(?:[.-][a-z0-9.]{1,30})?$/u,
          ),
      })
      .strict(),
    renderer: z.literal("compatibility"),
    threads: z.literal(false),
    executable: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u),
    title: z.string().trim().min(1).max(120).optional(),
    poster: packageFileNameSchema.optional(),
    files: z
      .array(packageFileSchema)
      .min(3)
      .max(CONVERSATION_WEB_PACKAGE_MAXIMUM_FILES),
  })
  .strict();

/** A manifest of a web export package as its schema reads it. */
export type ConversationWebPackageManifest = z.infer<
  typeof conversationWebPackageManifestSchema
>;

/** One start of a player: the address of its entry page and how long it serves. */
export interface ConversationWebPackageSession {
  /**
   * The entry page of the player, or with an own player origin the frame
   * document of Pages that holds it; it holds the access, never a path of
   * the server.
   */
  readonly url: string;
  readonly expiresAt: string;
  /**
   * Whether the player runs on an origin of its own, apart from Pages; the
   * frame then keeps that origin, otherwise the browser gives it an opaque one.
   */
  readonly isOwnOrigin: boolean;
}

/** A start of a player as the chat reads it from the answer of the server. */
export const conversationWebPackageSessionSchema = z.object({
  url: z.string().min(1).max(2000),
  expiresAt: z.string().min(1).max(40),
  isOwnOrigin: z.boolean(),
});

/**
 * Whether an attachment is a model Pages checked for the 3D viewer.
 * @param attachment - The attachment.
 */
export function isConversationModel(attachment: {
  readonly mimeType: string;
}): boolean {
  return attachment.mimeType === CONVERSATION_MODEL_MIME_TYPE;
}

/**
 * Whether an attachment is the manifest of a checked web export package.
 * @param attachment - The attachment.
 */
export function isConversationWebPackage(attachment: {
  readonly mimeType: string;
}): boolean {
  return attachment.mimeType === CONVERSATION_WEB_PACKAGE_MIME_TYPE;
}
