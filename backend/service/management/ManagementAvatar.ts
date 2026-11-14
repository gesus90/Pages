import { createHash } from "node:crypto";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { MAXIMUM_AVATAR_BYTES } from "@/definition/User";

import { managementAvatarSchema, parseManagement } from "./ManagementRequest";
import { ManagementUserWrite } from "./ManagementUserWrite";
import { requireManagementRevision } from "./ManagementRevision";

import type { StoredUserAvatar } from "@/backend/database/repositories/UserRepository";
import type { ManagementContext } from "./ManagementContext";
import type { ManagementResult } from "@/definition/Management";

const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "title",
  "desc",
]);
const SVG_ATTRIBUTES = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "transform",
  "offset",
  "stop-color",
  "stop-opacity",
  "id",
  "gradientUnits",
  "gradientTransform",
  "clip-path",
  "fill-rule",
  "stroke-linecap",
  "stroke-linejoin",
]);

/** Rebuilds SVG from inert drawing elements, dropping code, external links, entities and styles. */
export function sanitizeManagementSvg(source: string): string {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source))
    throw new AgentOperationError("INVALID_REQUEST", { reason: "avatar" });
  const withoutExecutable = source.replace(
    /<(script|foreignObject|style|image|use|text)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
    "",
  );
  return withoutExecutable.replace(/<[^>]*>/gu, (tag) => {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9]*)\b/u.exec(tag);
    if (!match || !SVG_TAGS.has(match[2] ?? "")) return "";
    const [, closing, name] = match;
    if (closing) return `</${name}>`;
    const attributes: string[] = [];
    for (const attribute of tag.matchAll(
      /([A-Za-z][\w:-]*)\s*=\s*(["'])(.*?)\2/gu,
    )) {
      const key = attribute[1] ?? "";
      const content = attribute[3] ?? "";
      if (!SVG_ATTRIBUTES.has(key) || /[<>&]/u.test(content)) continue;
      if (key === "xmlns" && content !== "http://www.w3.org/2000/svg") continue;
      if (
        key !== "xmlns" &&
        /(?:https?:|file:|data:|\/\/|url\s*\()/iu.test(content)
      )
        continue;
      attributes.push(`${key}="${content.replace(/"/gu, "&quot;")}"`);
    }
    return `<${name} ${attributes.join(" ")}${tag.endsWith("/>") ? "/" : ""}>`;
  });
}

/** Decodes an image and stores only a bounded server-rendered PNG. */
export async function managementAvatar(
  context: ManagementContext,
  userId: string,
  input: unknown,
): Promise<ManagementResult> {
  const request = parseManagement(managementAvatarSchema, input);
  const current = await new ManagementUserWrite(context).changeable(userId);
  requireManagementRevision(current.revision, request.expectedRevision);
  const avatar = await renderManagementAvatar(
    request.contentType,
    request.dataBase64,
  );
  const png = avatar.data;
  const avatarUrl = `/users/${userId}/avatar?v=${createHash("sha256").update(png).digest("hex")}`;
  await context.authorization.users().upsertAvatar(userId, avatar);
  await context.authorization.users().updateAvatarReference(userId, {
    avatarType: "image",
    avatarImageUrl: avatarUrl,
  });
  return { id: userId, avatarUrl };
}

/** Validates and converts avatars for the HTTP contract and the existing browser upload boundary. */
export async function renderManagementAvatar(
  contentType: string,
  dataBase64: string,
): Promise<StoredUserAvatar> {
  if (dataBase64.length > Math.ceil(MAXIMUM_AVATAR_BYTES / 3) * 4)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      dataBase64,
    )
  )
    throw new AgentOperationError("INVALID_REQUEST", { reason: "avatar" });
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length > MAXIMUM_AVATAR_BYTES)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  const signatures: Readonly<Record<string, boolean>> = {
    "image/png": bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    "image/webp":
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP",
    "image/svg+xml": true,
  };
  if (!signatures[contentType])
    throw new AgentOperationError("INVALID_REQUEST", { reason: "avatar" });
  const source =
    contentType === "image/svg+xml"
      ? Buffer.from(sanitizeManagementSvg(bytes.toString("utf8")))
      : bytes;
  let png: Buffer;
  try {
    const decoded = await loadImage(source);
    if (
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width > 4096 ||
      decoded.height > 4096
    )
      throw new Error("Invalid dimensions");
    const canvas = createCanvas(512, 512);
    canvas.getContext("2d").drawImage(decoded, 0, 0, 512, 512);
    png = await canvas.encode("png");
  } catch {
    throw new AgentOperationError("INVALID_REQUEST", { reason: "avatar" });
  }
  return { data: png, mimeType: "image/png", filename: "avatar.png" };
}
