import { readFile, stat } from "node:fs/promises";

import { CONVERSATION_MODEL_MAXIMUM_BYTES } from "@/definition/ConversationInteractiveContent";

/** `glTF` as the first four bytes of a binary glTF file, read little-endian. */
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Extensions a model may require; the viewer draws them or may ignore them. */
const SUPPORTED_REQUIRED_EXTENSIONS: ReadonlySet<string> = new Set([
  "KHR_materials_unlit",
]);

/** The image types the viewer decodes from the binary chunk. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** Why a model is not shown in the viewer. */
export type ModelRefusal = "format" | "tooLarge" | "reference" | "unsupported";

/** The result of checking a model. */
export type ModelInspection =
  | {
      readonly isValid: true;
      readonly meshCount: number;
      readonly textureCount: number;
    }
  | { readonly isValid: false; readonly refusal: ModelRefusal };

interface GlbChunks {
  readonly json: unknown;
  readonly binaryLength: number;
}

interface IndexedEntry {
  readonly [key: string]: unknown;
}

function refuse(refusal: ModelRefusal): ModelInspection {
  return { isValid: false, refusal };
}

function isRecord(input: unknown): input is IndexedEntry {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function listOf(document: IndexedEntry, key: string): readonly unknown[] {
  const entries = document[key];
  return Array.isArray(entries) ? entries : [];
}

function isCount(input: unknown): input is number {
  return typeof input === "number" && Number.isInteger(input) && input >= 0;
}

/** Reads the JSON and the length of the binary chunk; `null` for a broken container. */
function readChunks(bytes: Uint8Array): GlbChunks | null {
  if (bytes.byteLength < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  if (view.getUint32(4, true) !== GLB_VERSION) return null;
  if (view.getUint32(8, true) !== bytes.byteLength) return null;
  const jsonLength = view.getUint32(12, true);
  const jsonStart = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (view.getUint32(16, true) !== CHUNK_JSON) return null;
  if (jsonLength === 0 || jsonStart + jsonLength > bytes.byteLength)
    return null;
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(jsonStart, jsonStart + jsonLength),
      ),
    );
  } catch {
    return null;
  }
  const binaryHeader = jsonStart + jsonLength;
  if (binaryHeader + CHUNK_HEADER_BYTES > bytes.byteLength)
    return { json, binaryLength: 0 };
  const binaryLength = view.getUint32(binaryHeader, true);
  if (view.getUint32(binaryHeader + 4, true) !== CHUNK_BIN) return null;
  if (binaryHeader + CHUNK_HEADER_BYTES + binaryLength > bytes.byteLength)
    return null;
  return { json, binaryLength };
}

/** Every buffer view refers to the binary chunk and lies inside it. */
function checkBufferViews(
  document: IndexedEntry,
  bufferLength: number,
): ModelRefusal | null {
  for (const view of listOf(document, "bufferViews")) {
    if (!isRecord(view) || view.buffer !== 0) return "format";
    const offset = view.byteOffset ?? 0;
    if (!isCount(offset) || !isCount(view.byteLength)) return "format";
    if (offset + view.byteLength > bufferLength) return "format";
  }
  return null;
}

/** Checks that the only buffer is the binary chunk and every view lies inside it. */
function checkBuffers(
  document: IndexedEntry,
  binaryLength: number,
): ModelRefusal | null {
  const buffers = listOf(document, "buffers");
  if (buffers.length > 1) return "reference";
  const [buffer] = buffers;
  if (buffer !== undefined) {
    if (!isRecord(buffer) || !isCount(buffer.byteLength)) return "format";
    if (buffer.uri !== undefined) return "reference";
    if (buffer.byteLength > binaryLength) return "format";
  }
  const bufferLength =
    isRecord(buffer) && isCount(buffer.byteLength) ? buffer.byteLength : 0;
  return checkBufferViews(document, bufferLength);
}

/** Checks that every image is embedded in a buffer view with a type the viewer decodes. */
function checkImages(document: IndexedEntry): ModelRefusal | null {
  const viewCount = listOf(document, "bufferViews").length;
  for (const image of listOf(document, "images")) {
    if (!isRecord(image)) return "format";
    if (image.uri !== undefined) return "reference";
    if (!isCount(image.bufferView) || image.bufferView >= viewCount)
      return "format";
    if (typeof image.mimeType !== "string" || !IMAGE_TYPES.has(image.mimeType))
      return "unsupported";
  }
  return null;
}

function checkAccessors(document: IndexedEntry): ModelRefusal | null {
  const viewCount = listOf(document, "bufferViews").length;
  for (const accessor of listOf(document, "accessors")) {
    if (!isRecord(accessor) || !isCount(accessor.count)) return "format";
    if (accessor.sparse !== undefined) return "unsupported";
    if (
      accessor.bufferView !== undefined &&
      (!isCount(accessor.bufferView) || accessor.bufferView >= viewCount)
    )
      return "format";
  }
  return null;
}

function checkDocument(
  document: unknown,
  binaryLength: number,
): ModelInspection {
  if (!isRecord(document) || !isRecord(document.asset)) return refuse("format");
  const version = document.asset.version;
  if (typeof version !== "string" || !version.startsWith("2."))
    return refuse("format");
  for (const extension of listOf(document, "extensionsRequired"))
    if (
      typeof extension !== "string" ||
      !SUPPORTED_REQUIRED_EXTENSIONS.has(extension)
    )
      return refuse("unsupported");
  const refusal =
    checkBuffers(document, binaryLength) ??
    checkImages(document) ??
    checkAccessors(document);
  if (refusal !== null) return refuse(refusal);
  const meshCount = listOf(document, "meshes").length;
  if (meshCount === 0) return refuse("format");
  return {
    isValid: true,
    meshCount,
    textureCount: listOf(document, "textures").length,
  };
}

/**
 * Checks a model for the 3D viewer of the chat.
 * @param bytes - The whole file.
 * @returns Whether the chat shows it, and why not.
 * @remarks
 * Pages shows only a self-contained glTF 2.0 binary file (`.glb`) up to
 * 64 MB: a valid container with its JSON chunk, at most one buffer, which is
 * the binary chunk of the file, buffer views that lie inside it, and
 * textures embedded as PNG, JPEG or WebP. A reference to any other file or
 * address (`uri`), including data addresses, is refused, so the viewer never
 * loads anything but the checked file. Extensions the viewer cannot draw
 * must not be required.
 */
export function inspectModelBytes(bytes: Uint8Array): ModelInspection {
  if (bytes.byteLength > CONVERSATION_MODEL_MAXIMUM_BYTES)
    return refuse("tooLarge");
  const chunks = readChunks(bytes);
  if (chunks === null) return refuse("format");
  return checkDocument(chunks.json, chunks.binaryLength);
}

/**
 * Checks a model file on the disk of the server.
 * @param filePath - The resolved path of the file.
 * @returns Whether the chat shows it, and why not.
 */
export async function inspectModelFile(
  filePath: string,
): Promise<ModelInspection> {
  const facts = await stat(filePath);
  if (facts.size > CONVERSATION_MODEL_MAXIMUM_BYTES) return refuse("tooLarge");
  return inspectModelBytes(await readFile(filePath));
}

/**
 * Checks a stored model while it is read from the file store.
 * @param source - The bytes of the stored file.
 * @returns Whether the chat shows it, and why not; a file above the limit
 * stops being read at the limit.
 */
export async function inspectModelStream(
  source: AsyncIterable<Uint8Array | string>,
): Promise<ModelInspection> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.byteLength;
    if (size > CONVERSATION_MODEL_MAXIMUM_BYTES) return refuse("tooLarge");
    chunks.push(Buffer.from(bytes));
  }
  return inspectModelBytes(Buffer.concat(chunks));
}
