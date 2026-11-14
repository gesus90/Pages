import { imageTypeOf } from "./document-model";
import { attributeOf, childrenNamed, parseXml, resolvePartPath, textOf, descendantNamed } from "./xml-nodes";

import type { ZipArchive } from "./zip-entries";

/** One relation of an Office part: an image, a slide, a sheet or a link. */
export interface OfficeRelation {
  /** The path in the package, or the address of an external target. */
  readonly target: string;
  /** The target lies outside the file; Pages never loads it by itself. */
  readonly isExternal: boolean;
}

/**
 * Reads the relations of a part of an Office package.
 *
 * @param archive - The package.
 * @param part - The path of the part, such as `word/document.xml`.
 * @returns The relations by their ID; internal targets resolved to package paths.
 */
export async function readRelations(
  archive: ZipArchive,
  part: string,
): Promise<Map<string, OfficeRelation>> {
  const slash = part.lastIndexOf("/");
  const path = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const relations = new Map<string, OfficeRelation>();
  const text = await archive.readText(path);
  const root = text === null ? null : parseXml(text);
  if (!root) return relations;
  for (const relation of childrenNamed(root, "Relationship")) {
    const id = attributeOf(relation, "Id");
    const target = attributeOf(relation, "Target");
    if (id === null || target === null) continue;
    const isExternal = attributeOf(relation, "TargetMode") === "External";
    relations.set(id, {
      target: isExternal ? target : resolvePartPath(part, target),
      isExternal,
    });
  }
  return relations;
}

/**
 * Collects the embedded images of a document as data.
 *
 * @remarks
 * Only images inside the package are read; an image that points outside the
 * file is never loaded (PAGE-385). Formats a browser cannot show are left out.
 */
export class PackageImages {
  public readonly images = new Map<string, Blob>();
  private readonly archive: ZipArchive;

  public constructor(archive: ZipArchive) {
    this.archive = archive;
  }

  /**
   * Reads an image of the package once.
   *
   * @param path - The path in the package.
   * @returns The ID of the image, or `null` for a missing or unsupported one.
   */
  public async add(path: string): Promise<string | null> {
    if (this.images.has(path)) return path;
    const type = imageTypeOf(path);
    if (type === null) return null;
    const bytes = await this.archive.read(path);
    if (bytes === null) return null;
    this.images.set(path, new Blob([bytes], { type }));
    return path;
  }

  /**
   * Reads the image a relation names, when it lies inside the package.
   *
   * @param relation - The relation, or `undefined`.
   */
  public async addRelation(relation: OfficeRelation | undefined): Promise<string | null> {
    if (!relation || relation.isExternal) return null;
    return this.add(relation.target);
  }
}

/**
 * The title of an Office file from `docProps/core.xml`.
 *
 * @param archive - The package.
 * @returns The title, or `null` when the file names none.
 */
export async function readOfficeTitle(archive: ZipArchive): Promise<string | null> {
  const text = await archive.readText("docProps/core.xml");
  const root = text === null ? null : parseXml(text);
  const title = root ? textOf(descendantNamed(root, "title")).trim() : "";
  return title === "" ? null : title;
}

/**
 * Whether an attribute such as `w:b` switches its emphasis on: present
 * without a value or with a value other than `0`, `false`, `off` or `none`.
 *
 * @param element - The property element, or `null` when it is missing.
 */
export function isSwitchedOn(element: Element | null): boolean {
  if (!element) return false;
  const value = attributeOf(element, "val");
  return value === null || !["0", "false", "off", "none"].includes(value);
}
