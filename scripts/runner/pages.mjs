import { createServer, createConnection } from "node:net";
import { chmod, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const RESOURCE_ERRORS = new Set([
  "parameter_asset_unavailable",
  "parameter_assets_too_large",
  "parameter_asset_type_unsupported",
  "parameter_asset_reference_unsupported",
  "parameter_ticket_changed",
  "parameter_ticket_unavailable",
  "parameter_reference_unavailable",
  "plan_mcp_unavailable",
  "plan_context_changed",
]);

/** Allows only stable preparation codes to cross process and journal boundaries. */
export function pagesFailure(error) {
  return RESOURCE_ERRORS.has(error?.code) ? error.code : "plan_mcp_unavailable";
}

const MAXIMUM_RPC_BYTES = 2 * 1024 * 1024;

/** Sends no credentials: the private local socket reaches only the existing runner channel. */
export function pagesRequest(socketPath, jobId, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let reply = "";
    socket.setTimeout(25000, () =>
      socket.destroy(new Error("Pages access timed out")),
    );
    socket.on("error", () => reject(new Error("Pages access unavailable")));
    socket.on("connect", () =>
      socket.end(JSON.stringify({ jobId, request }) + "\n"),
    );
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (Buffer.byteLength(reply) > MAXIMUM_RPC_BYTES)
        socket.destroy(new Error("Pages reply limit"));
    });
    socket.on("end", () => {
      try {
        const message = JSON.parse(reply);
        if (!message.ok) {
          const failure = new Error("Pages access refused");
          failure.code = pagesFailure(message);
          reject(failure);
          return;
        }
        resolve(message.result);
      } catch {
        reject(new Error("Pages access refused"));
      }
    });
  });
}

/** Holds the socket only while the transport runs; neither a token nor a login is written here. */
export async function startPagesRelay(directory, request) {
  const socketPath = join(directory, "pages.sock");
  await rm(socketPath, { force: true });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let input = "";
    socket.setTimeout(30000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input) > 65536) socket.destroy();
    });
    socket.on("end", () => {
      void (async () => {
        try {
          const message = JSON.parse(input);
          if (!/^[a-f0-9-]{36}$/.test(message.jobId))
            throw new Error("Invalid job");
          const result = await request(message.jobId, message.request);
          socket.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          socket.end(JSON.stringify({ ok: false, code: pagesFailure(error) }));
        }
      })();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  return async () => {
    server.close();
    await rm(socketPath, { force: true });
  };
}

/** Downloads bounded chunks after Pages rechecks live owner and file rights for each transmission. */
export async function preparePagesFiles(command, folder, jobId, signal) {
  const socketPath = join(folder, "..", "..", "pages.sock");
  const manifest = await pagesRequest(socketPath, jobId, { kind: "prepare" });
  if (!Array.isArray(manifest.files) || manifest.files.length > 64)
    throw new Error("Invalid Pages files");
  const directory = join(folder, "runtime", "assets");
  await mkdir(directory, { mode: 0o700 });
  const files = [];
  let total = 0;
  for (const [index, file] of manifest.files.entries()) {
    if (
      !["image/png", "text/plain"].includes(file.type) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    )
      throw new Error("Invalid Pages file");
    total += file.size;
    if (total > 10 * 1024 * 1024) throw new Error("Pages file limit");
    const chunks = [];
    let offset = 0;
    do {
      signal.throwIfAborted();
      const chunk = await pagesRequest(socketPath, jobId, {
        kind: "asset",
        index,
        offset,
      });
      const bytes = Buffer.from(chunk.base64, "base64");
      if (
        bytes.length > 512 * 1024 ||
        chunk.size !== file.size ||
        (!bytes.length && offset < file.size)
      )
        throw new Error("Invalid Pages chunk");
      chunks.push(bytes);
      offset += bytes.length;
      if (offset > file.size) throw new Error("Pages file overflow");
    } while (offset < file.size);
    const bytes = Buffer.concat(chunks);
    if (createHash("sha256").update(bytes).digest("hex") !== file.digest)
      throw new Error("Pages file changed");
    const path = join(
      directory,
      `${index}${file.type === "image/png" ? ".png" : ".txt"}`,
    );
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    files.push({ ...file, path });
  }
  await writeFile(join(directory, "manifest.json"), JSON.stringify(files), {
    mode: 0o600,
    flag: "wx",
  });
  const instructions =
    "\n\nPages tools are available through the pages MCP server for this step only. Use read_parameter_file with the file index to read text or view an image. Parameter files (outside the workspace; removed at step end):\n" +
    JSON.stringify(
      files.map((file, index) => ({
        index,
        parameter: file.parameter,
        name: file.name,
        type: file.type,
        size: file.size,
        path: file.path,
      })),
    );
  return {
    ...command,
    program: {
      ...command.program,
      prompt: command.program.prompt + instructions,
    },
  };
}

const FILE_TOOL = {
  name: "read_parameter_file",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Reads a transferred Pages parameter attachment by its manifest index. Returns the complete text or PNG image. Access ends with this step.",
  inputSchema: {
    type: "object",
    properties: { index: { type: "integer", minimum: 0, maximum: 63 } },
    required: ["index"],
    additionalProperties: false,
  },
};

async function readParameterFile(socketPath, jobId, parameters) {
  await pagesRequest(socketPath, jobId, { kind: "lease" });
  const directory = join(
    dirname(socketPath),
    "jobs",
    jobId,
    "runtime",
    "assets",
  );
  const files = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  const file = Number.isInteger(parameters.index)
    ? files[parameters.index]
    : null;
  if (!file) throw new Error("Parameter file unavailable");
  const bytes = await readFile(file.path);
  return {
    content: [
      file.type === "image/png"
        ? {
            type: "image",
            mimeType: "image/png",
            data: bytes.toString("base64"),
          }
        : { type: "text", text: bytes.toString("utf8") },
    ],
  };
}

async function mcpReply(message, socketPath, jobId) {
  if (message.method === "initialize")
    return {
      protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "pages-run-step", version: "1.7.0" },
    };
  if (message.method === "ping") return {};
  if (message.method === "tools/list") {
    const catalog = await pagesRequest(socketPath, jobId, { kind: "list" });
    return { tools: [...catalog.tools, FILE_TOOL] };
  }
  if (message.method === "tools/call") {
    const parameters = message.params?.arguments ?? {};
    if (message.params?.name === FILE_TOOL.name)
      return readParameterFile(socketPath, jobId, parameters);
    const result = await pagesRequest(socketPath, jobId, {
      kind: "call",
      name: message.params?.name,
      arguments: parameters,
    });
    return {
      ...(result?.isError ? { isError: true } : {}),
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
  throw new Error("Unsupported Pages MCP method");
}

async function serveMcp(socketPath, jobId) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Invalid Pages job");
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let message;
    try {
      if (Buffer.byteLength(line) > 65536)
        throw new Error("Pages MCP input limit");
      message = JSON.parse(line);
      if (message.id === undefined) continue;
      const result = await mcpReply(message, socketPath, jobId);
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n",
      );
    } catch {
      if (message?.id !== undefined)
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32603,
              message: "Pages step access unavailable or request refused.",
            },
          }) + "\n",
        );
    }
  }
}

if (process.argv[2] === "--mcp")
  await serveMcp(process.argv[3], process.argv[4]);
