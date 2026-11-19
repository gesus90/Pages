/**
 * Reads a binary glTF 2.0 model (`.glb`) into what the viewer of the chat
 * draws: triangle meshes in world space with their base color and
 * embedded texture. Nothing outside the file is ever loaded: the server
 * stores a model as such only without references, and this reader refuses
 * them again.
 */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const MODE_TRIANGLES = 4;

const COMPONENT_COUNTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

interface ComponentKind {
  readonly bytes: number;
  readonly read: (view: DataView, offset: number) => number;
  /** The largest value, for normalized integers. */
  readonly range: number;
}

const COMPONENT_KINDS: Readonly<Record<number, ComponentKind>> = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset), range: 127 },
  5121: {
    bytes: 1,
    read: (view, offset) => view.getUint8(offset),
    range: 255,
  },
  5122: {
    bytes: 2,
    read: (view, offset) => view.getInt16(offset, true),
    range: 32767,
  },
  5123: {
    bytes: 2,
    read: (view, offset) => view.getUint16(offset, true),
    range: 65535,
  },
  5125: {
    bytes: 4,
    read: (view, offset) => view.getUint32(offset, true),
    range: 4294967295,
  },
  5126: {
    bytes: 4,
    read: (view, offset) => view.getFloat32(offset, true),
    range: 1,
  },
};

/** A column-major 4×4 matrix. */
export type Matrix = Float32Array;

/** An embedded image of the model, ready to decode. */
export interface ModelImage {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** One triangle mesh as the viewer draws it. */
export interface ModelPrimitive {
  readonly positions: Float32Array;
  /** Missing: the viewer shades the faces flat. */
  readonly normals: Float32Array | null;
  readonly texcoords: Float32Array | null;
  readonly indices: Uint32Array | null;
  readonly vertexCount: number;
  readonly world: Matrix;
  readonly baseColor: readonly [number, number, number, number];
  /** The index in {@link GlbModel.images}, or `null` without a texture. */
  readonly imageIndex: number | null;
  readonly isUnlit: boolean;
  readonly alphaCutoff: number | null;
  readonly isBlended: boolean;
}

/** A model the viewer can draw. */
export interface GlbModel {
  readonly primitives: readonly ModelPrimitive[];
  readonly images: readonly ModelImage[];
  /** The center and the radius of the bounding sphere in world space. */
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

/** A model the reader refuses; the card shows its start image instead. */
export class GlbModelError extends Error {}

type JsonEntry = Readonly<Record<string, unknown>>;

interface GlbParts {
  readonly json: JsonEntry;
  readonly binary: Uint8Array;
}

function entry(input: unknown): JsonEntry {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new GlbModelError("Invalid glTF entry");
  // A checked object of the parsed JSON; its fields are read with checks.
  return input as JsonEntry;
}

function list(json: JsonEntry, key: string): readonly unknown[] {
  const entries = json[key];
  return Array.isArray(entries) ? entries : [];
}

function at(json: JsonEntry, key: string, index: unknown): JsonEntry {
  if (typeof index !== "number") throw new GlbModelError(`Missing ${key}`);
  return entry(list(json, key)[index]);
}

function numbers(input: unknown, length: number): number[] | null {
  if (!Array.isArray(input) || input.length !== length) return null;
  const items: readonly unknown[] = input;
  return items.every((item) => typeof item === "number")
    ? items.map(Number)
    : null;
}

function readParts(buffer: ArrayBuffer): GlbParts {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC)
    throw new GlbModelError("Not a binary glTF file");
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== CHUNK_JSON ||
    20 + jsonLength > buffer.byteLength
  )
    throw new GlbModelError("Missing JSON chunk");
  const json = entry(
    JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
    ),
  );
  const binaryStart = 20 + jsonLength;
  if (binaryStart + 8 > buffer.byteLength)
    return { json, binary: new Uint8Array(0) };
  const binaryLength = view.getUint32(binaryStart, true);
  if (view.getUint32(binaryStart + 4, true) !== CHUNK_BIN)
    throw new GlbModelError("Unknown second chunk");
  return {
    json,
    binary: new Uint8Array(buffer, binaryStart + 8, binaryLength),
  };
}

/** The bytes of a buffer view; only the binary chunk is a buffer. */
function viewBytes(parts: GlbParts, index: unknown): Uint8Array {
  const view = at(parts.json, "bufferViews", index);
  const buffer = at(parts.json, "buffers", view.buffer);
  if (buffer.uri !== undefined)
    throw new GlbModelError("External buffers are not loaded");
  const offset = typeof view.byteOffset === "number" ? view.byteOffset : 0;
  const length = Number(view.byteLength);
  if (offset + length > parts.binary.byteLength)
    throw new GlbModelError("Buffer view outside the file");
  return parts.binary.subarray(offset, offset + length);
}

/** Reads an accessor as floats, normalized integers in 0..1 or -1..1. */
function readAccessor(parts: GlbParts, index: unknown): Float32Array {
  const accessor = at(parts.json, "accessors", index);
  const components = COMPONENT_COUNTS[String(accessor.type)];
  const kind = COMPONENT_KINDS[Number(accessor.componentType)];
  const count = Number(accessor.count);
  if (!components || !kind || !Number.isInteger(count))
    throw new GlbModelError("Unsupported accessor");
  const values = new Float32Array(count * components);
  if (accessor.bufferView === undefined) return values;
  const bytes = viewBytes(parts, accessor.bufferView);
  const bufferView = at(parts.json, "bufferViews", accessor.bufferView);
  const stride =
    typeof bufferView.byteStride === "number"
      ? bufferView.byteStride
      : components * kind.bytes;
  const start =
    typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isNormalized = accessor.normalized === true;
  for (let item = 0; item < count; item += 1)
    for (let part = 0; part < components; part += 1) {
      const offset = start + item * stride + part * kind.bytes;
      if (offset + kind.bytes > bytes.byteLength)
        throw new GlbModelError("Accessor outside its view");
      const raw = kind.read(view, offset);
      values[item * components + part] = isNormalized
        ? Math.max(raw / kind.range, -1)
        : raw;
    }
  return values;
}

function readIndices(parts: GlbParts, index: unknown): Uint32Array | null {
  if (index === undefined) return null;
  return Uint32Array.from(readAccessor(parts, index));
}

/** The column-major matrix of a translation, a rotation quaternion and a scale. */
function composeMatrix(node: JsonEntry): Matrix {
  const given = numbers(node.matrix, 16);
  if (given) return Float32Array.from(given);
  const [tx, ty, tz] = numbers(node.translation, 3) ?? [0, 0, 0];
  const [x, y, z, w] = numbers(node.rotation, 4) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = numbers(node.scale, 3) ?? [1, 1, 1];
  return Float32Array.from([
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}

/**
 * Multiplies two column-major matrices.
 * @param left - The outer transform.
 * @param right - The inner transform.
 * @returns `left × right`.
 */
export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1)
        sum += (left[k * 4 + row] ?? 0) * (right[column * 4 + k] ?? 0);
      result[column * 4 + row] = sum;
    }
  return result;
}

/** The alpha below which a masked material shows nothing; 0.5 by default. */
function cutoffOf(material: JsonEntry): number {
  return typeof material.alphaCutoff === "number" ? material.alphaCutoff : 0.5;
}

function readMaterial(
  parts: GlbParts,
  index: unknown,
): Pick<
  ModelPrimitive,
  "baseColor" | "imageIndex" | "isUnlit" | "alphaCutoff" | "isBlended"
> {
  const fallback = {
    baseColor: [0.8, 0.8, 0.8, 1] as const,
    imageIndex: null,
    isUnlit: false,
    alphaCutoff: null,
    isBlended: false,
  };
  if (index === undefined) return fallback;
  const material = at(parts.json, "materials", index);
  const pbr = material.pbrMetallicRoughness
    ? entry(material.pbrMetallicRoughness)
    : {};
  const [red = 1, green = 1, blue = 1, alpha = 1] =
    numbers(pbr.baseColorFactor, 4) ?? [];
  const texture = pbr.baseColorTexture
    ? at(parts.json, "textures", entry(pbr.baseColorTexture).index)
    : null;
  const extensions = material.extensions ? entry(material.extensions) : {};
  return {
    baseColor: [red, green, blue, alpha],
    imageIndex: typeof texture?.source === "number" ? texture.source : null,
    isUnlit: extensions.KHR_materials_unlit !== undefined,
    alphaCutoff: material.alphaMode === "MASK" ? cutoffOf(material) : null,
    isBlended: material.alphaMode === "BLEND",
  };
}

function readPrimitive(
  parts: GlbParts,
  primitive: JsonEntry,
  world: Matrix,
): ModelPrimitive | null {
  const mode = typeof primitive.mode === "number" ? primitive.mode : 4;
  if (mode !== MODE_TRIANGLES) return null;
  const attributes = entry(primitive.attributes);
  if (attributes.POSITION === undefined) return null;
  const positions = readAccessor(parts, attributes.POSITION);
  return {
    positions,
    normals:
      attributes.NORMAL === undefined
        ? null
        : readAccessor(parts, attributes.NORMAL),
    texcoords:
      attributes.TEXCOORD_0 === undefined
        ? null
        : readAccessor(parts, attributes.TEXCOORD_0),
    indices: readIndices(parts, primitive.indices),
    vertexCount: positions.length / 3,
    world,
    ...readMaterial(parts, primitive.material),
  };
}

/** The parts and the primitives a node walk reads into. */
interface NodeWalk {
  readonly parts: GlbParts;
  readonly primitives: ModelPrimitive[];
}

/** Collects the primitives of a node and its children in world space. */
function collectNode(
  walk: NodeWalk,
  nodeIndex: unknown,
  parent: Matrix,
  depth = 0,
): void {
  if (depth > 64) throw new GlbModelError("Node tree too deep");
  const { parts, primitives } = walk;
  const node = at(parts.json, "nodes", nodeIndex);
  const world = multiplyMatrices(parent, composeMatrix(node));
  if (node.mesh !== undefined)
    for (const primitive of list(
      at(parts.json, "meshes", node.mesh),
      "primitives",
    )) {
      const read = readPrimitive(parts, entry(primitive), world);
      if (read) primitives.push(read);
    }
  for (const child of list(node, "children"))
    collectNode(walk, child, world, depth + 1);
}

/** The root nodes of the scene to show: the default scene, else every node no other node holds. */
function rootNodes(json: JsonEntry): readonly unknown[] {
  const scenes = list(json, "scenes");
  const sceneIndex = typeof json.scene === "number" ? json.scene : 0;
  const scene = scenes[sceneIndex];
  if (scene !== undefined) return list(entry(scene), "nodes");
  const children = new Set(
    list(json, "nodes").flatMap((node) => list(entry(node), "children")),
  );
  return list(json, "nodes")
    .map((_, index) => index)
    .filter((index) => !children.has(index));
}

function transformPoint(
  matrix: Matrix,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const value = (index: number): number => matrix[index] ?? 0;
  return [
    value(0) * x + value(4) * y + value(8) * z + value(12),
    value(1) * x + value(5) * y + value(9) * z + value(13),
    value(2) * x + value(6) * y + value(10) * z + value(14),
  ];
}

/** Grows the low and high corner of the bounds by the vertices of one primitive. */
function extendBounds(
  low: number[],
  high: number[],
  primitive: ModelPrimitive,
): void {
  for (let vertex = 0; vertex < primitive.vertexCount; vertex += 1) {
    const point = transformPoint(
      primitive.world,
      primitive.positions[vertex * 3] ?? 0,
      primitive.positions[vertex * 3 + 1] ?? 0,
      primitive.positions[vertex * 3 + 2] ?? 0,
    );
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis] ?? 0, point[axis] ?? 0);
      high[axis] = Math.max(high[axis] ?? 0, point[axis] ?? 0);
    }
  }
}

/** The bounding sphere of every vertex in world space. */
function boundsOf(
  primitives: readonly ModelPrimitive[],
): Pick<GlbModel, "center" | "radius"> {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives) extendBounds(low, high, primitive);
  const middle = (axis: number): number =>
    ((low[axis] ?? 0) + (high[axis] ?? 0)) / 2;
  const center: [number, number, number] = [middle(0), middle(1), middle(2)];
  const radius =
    Math.hypot(
      (high[0] ?? 0) - (low[0] ?? 0),
      (high[1] ?? 0) - (low[1] ?? 0),
      (high[2] ?? 0) - (low[2] ?? 0),
    ) / 2;
  return { center, radius: Number.isFinite(radius) && radius > 0 ? radius : 1 };
}

/**
 * Reads a binary glTF model for the viewer.
 * @param buffer - The bytes of the `.glb` file.
 * @returns The meshes of its scene, its embedded images and its bounds.
 * @throws {GlbModelError} For a broken file, a reference to another file or
 * a scene without triangles.
 */
export function readGlbModel(buffer: ArrayBuffer): GlbModel {
  const parts = readParts(buffer);
  const images = list(parts.json, "images").map((image) => {
    const read = entry(image);
    if (read.uri !== undefined)
      throw new GlbModelError("External images are not loaded");
    return {
      bytes: viewBytes(parts, read.bufferView),
      mimeType: typeof read.mimeType === "string" ? read.mimeType : "image/png",
    };
  });
  const primitives: ModelPrimitive[] = [];
  const identity = Float32Array.from([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);
  const walk: NodeWalk = { parts, primitives };
  for (const node of rootNodes(parts.json)) collectNode(walk, node, identity);
  if (primitives.length === 0)
    throw new GlbModelError("The scene holds no triangles");
  return { primitives, images, ...boundsOf(primitives) };
}
