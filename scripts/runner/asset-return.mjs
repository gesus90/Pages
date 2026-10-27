import { constants } from "node:fs";
import { open, readFile, realpath, lstat } from "node:fs/promises";
import { join, relative, resolve, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";

/** Metadata-only tool; the binary payload uses the authenticated runner channel instead of MCP arguments. */
export const RETURN_ASSET_TOOL = {
  name: "return_asset",
  description:
    "Publishes an actually edited file from this job's authorized workspace as a permanent ticket attachment. Requires existing write/YOLO access and an operationId retained for response-loss replay. sourceAttachmentId and expectedDigest record provenance; replace=true explicitly selects a revision and conflicts if already replaced. Original attachments remain downloadable. A renamed unchanged file is refused when provenance is supplied. Use a real editor for raster changes; if unavailable report the missing tool. No host paths outside this workspace or symlinks. Maximum output: 10 MiB total, 64 files per step. Success is returned only after Pages storage commits.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", maxLength: 1000 },
      ticketId: { type: "string", format: "uuid" },
      pageId: { type: "string", format: "uuid" },
      fileName: { type: "string", maxLength: 255 },
      operationId: { type: "string", maxLength: 100 },
      sourceAttachmentId: { type: "string", format: "uuid" },
      sourceType: { type: "string", enum: ["ticket", "wiki", "agent"] },
      expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      replace: { type: "boolean" },
    },
    required: ["path", "fileName", "operationId"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Reads no foreign file and never executes attached content; checks identity before and after reading. */
export async function returnAsset(socketPath, jobId, parameters, request) {
  const folder = join(dirname(socketPath), "jobs", jobId);
  const claim = JSON.parse(await readFile(join(folder, "claim.json"), "utf8"));
  const root = await realpath(claim.execution.workspace);
  if (typeof parameters.path !== "string")
    throw new Error("Output file missing");
  const target = resolve(root, parameters.path);
  const local = relative(root, target);
  if (!local || local.startsWith("..") || isAbsolute(local))
    throw new Error("Output outside workspace");
  let current = root;
  for (const segment of local.split("/")) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Output symlink refused");
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 10 * 1024 * 1024)
      throw new Error("Invalid output file size");
    bytes = await boundedOutput(file, before.size);
    const after = await file.stat();
    const current = await lstat(target);
    if (
      current.isSymbolicLink() ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      bytes.length !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      (await realpath(target)) !== target
    )
      throw new Error("Output changed");
  } finally {
    await file.close();
  }
  const metadata = { ...parameters };
  delete metadata.path;
  const prepared = await request(socketPath, jobId, {
    kind: "call",
    name: "prepare_asset_upload",
    arguments: metadata,
  });
  const ticket = prepared?.result?.ticket;
  if (typeof ticket !== "string")
    throw new Error("Upload authorization refused");
  const digest = createHash("sha256").update(bytes).digest("hex");
  let result;
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    result = await request(socketPath, jobId, {
      kind: "upload",
      ticket,
      offset,
      base64: bytes.subarray(offset, offset + 32768).toString("base64"),
      done: offset + 32768 >= bytes.length,
      digest,
    });
  }
  if (!result?.link) throw new Error("Upload did not complete");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

/** Reads at most the declared size plus one byte, detecting growth without unbounded allocation. */
export async function boundedOutput(file, size) {
  const buffer = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const read = await file.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (!read.bytesRead) break;
    offset += read.bytesRead;
  }
  return buffer.subarray(0, offset);
}
