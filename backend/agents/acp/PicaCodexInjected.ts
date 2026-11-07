/** JavaScript embedded into the pinned adapter; the glue module is supplied by Pages. */
export const PICA_CODEX_INJECTED = String.raw`
const pagesGlueHandle = await pagesOpen(pagesGluePath, pagesFsConstants.O_RDONLY | pagesFsConstants.O_NOFOLLOW);
let pagesGlueBytes;
try {
  const facts = await pagesGlueHandle.stat();
  if (!facts.isFile() || facts.size > 262144 || facts.size < 1) throw new Error("Pica glue refused");
  const bytes = Buffer.alloc(262145);
  let size = 0;
  while (size < bytes.length) {
    const result = await pagesGlueHandle.read(bytes, size, bytes.length - size, null);
    if (result.bytesRead === 0) break;
    size += result.bytesRead;
  }
  if (size > 262144) throw new Error("Pica glue refused");
  pagesGlueBytes = bytes.subarray(0, size);
} finally {
  await pagesGlueHandle.close();
}
if (pagesHash("sha256").update(pagesGlueBytes).digest("hex") !== pagesGlueDigest) throw new Error("Pica glue refused");
let pagesGlueFactory;
try {
  const module = await import("data:text/javascript;base64," + pagesGlueBytes.toString("base64"));
  if (typeof module.createPicaCodexGlue !== "function") throw new Error("Pica glue unavailable");
  pagesGlueFactory = module.createPicaCodexGlue;
} catch {
  throw new Error("Pica glue unavailable");
}
let pagesGlue = null;
function pagesAttachClient(connection) {
  if (pagesGlue !== null || typeof connection?.request !== "function") throw new Error("Pica glue unavailable");
  pagesGlue = pagesGlueFactory((method, params) => connection.request(method, params));
  for (const method of ["catalog", "policyContext", "bindThread", "prepare", "ready", "revoke", "cancelPrepare", "endTurn", "closeThread", "dispatch"]) {
    if (typeof pagesGlue?.[method] !== "function") throw new Error("Pica glue unavailable");
  }
}
async function pagesInvoke(method, ...args) {
  try {
    if (!pagesGlue) throw new Error("Pica glue unavailable");
    return await pagesGlue[method](...args);
  } catch {
    throw new Error("Pica glue refused");
  }
}
const pagesThreads = new Map();
const pagesInvalidatedContexts = new Set();
const pagesBindings = new Map();
const pagesRetiredBindings = new Map();
const pagesEarlyInvalidations = new Map();
let pagesIssuedContext = null;
let pagesConnectionSettlement = null;
function pagesConnectionLost() {
  if (pagesConnectionSettlement) return;
  for (const binding of pagesBindings.values()) {
    binding.invalidated = true;
    pagesInvalidatedContexts.add(binding.context);
  }
  pagesConnectionSettlement = Promise.all([
    ...Array.from(pagesThreads.keys(), (threadId) => pagesCloseThread(threadId)),
    ...Array.from(pagesBindings, ([threadId, binding]) => pagesCloseBinding(threadId, binding)),
  ]);
  pagesConnectionSettlement.catch(() => {});
}
const pagesRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pagesId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
const pagesSize = (value, limit) => {
  const json = JSON.stringify(value);
  return typeof json === "string" && Buffer.byteLength(json, "utf8") <= limit;
};
async function pagesCatalog() {
  const catalog = await pagesInvoke("catalog");
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 512 || !pagesSize(catalog, 1048576)) throw new Error("Pica catalog refused");
  const names = new Set();
  return catalog.map((entry) => {
    if (!pagesRecord(entry) || Object.keys(entry).some((key) => !["name", "description", "inputSchema"].includes(key)) ||
        typeof entry.name !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(entry.name) || names.has(entry.name) ||
        typeof entry.description !== "string" || entry.description.length < 1 || entry.description.length > 10000 ||
        !pagesRecord(entry.inputSchema) || entry.inputSchema.type !== "object") throw new Error("Pica catalog refused");
    names.add(entry.name);
    return { type: "function", name: entry.name, description: entry.description, inputSchema: JSON.parse(JSON.stringify(entry.inputSchema)) };
  });
}
function pagesCanonical(value) {
  if (Array.isArray(value)) return value.map(pagesCanonical);
  if (pagesRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, pagesCanonical(value[key])]));
  return value;
}
async function pagesCreatePolicy(tools) {
  const context = await pagesInvoke("policyContext");
  if (typeof context !== "string" || !/^[a-f0-9]{64}$/.test(context)) throw new Error("Pica policy refused");
  pagesIssuedContext = context;
  return { version: 1, context, catalog: tools };
}
function pagesVerifyPolicy(response, policy) {
  const ack = response?.picaPolicyAck;
  if (!pagesRecord(ack) || Object.keys(ack).some((key) => !["version", "context", "catalog", "threadId"].includes(key)) ||
      ack.version !== policy.version || ack.context !== policy.context || !pagesId(ack.threadId) || ack.threadId !== response?.thread?.id ||
      !pagesSize(ack.catalog, 1048576) || JSON.stringify(pagesCanonical(ack.catalog)) !== JSON.stringify(pagesCanonical(policy.catalog))) throw new Error("Pica policy refused");
}
function pagesCloseBinding(threadId, binding) {
  if (!binding.closePromise) {
    binding.closePromise = (async () => {
      if (await binding.promise !== true) throw new Error("Pica binding unavailable");
      await pagesInvoke("closeThread", threadId);
    })();
  }
  return binding.closePromise;
}
async function pagesBindThread(threadId, tools, context) {
  if (pagesConnectionSettlement || !pagesId(threadId) || !/^[a-f0-9]{64}$/.test(context) || pagesThreads.has(threadId) || pagesBindings.has(threadId) || pagesThreads.size + pagesBindings.size >= 16 || pagesInvalidatedContexts.has(context)) throw new Error("Pica thread refused");
  const binding = { context, invalidated: false, accepted: false, refused: false, promise: null, closePromise: null };
  pagesBindings.set(threadId, binding);
  binding.promise = pagesInvoke("bindThread", threadId, context);
  try {
    const accepted = await binding.promise;
    if (accepted !== true) {
      binding.refused = accepted === false;
      throw new Error("Pica thread refused");
    }
    binding.accepted = true;
    if (binding.invalidated || pagesConnectionSettlement || pagesInvalidatedContexts.has(context)) {
      await pagesCloseBinding(threadId, binding);
      throw new Error("Pica thread refused");
    }
    pagesThreads.set(threadId, { names: new Set(tools.map((tool) => tool.name)), catalog: tools, context, calls: new Set(), turn: null, pending: null, closing: false });
  } finally {
    if (pagesBindings.get(threadId) === binding) {
      if (binding.invalidated && binding.refused) pagesRetiredBindings.set(threadId, binding);
      if (binding.refused || (binding.accepted && !binding.invalidated)) pagesBindings.delete(threadId);
    }
  }
}
async function pagesPrepareTurn(threadId) {
  const thread = pagesThreads.get(threadId);
  if (pagesConnectionSettlement || !thread || thread.closing || thread.turn || thread.pending) throw new Error("Pica turn refused");
  const operation = await pagesInvoke("prepare", threadId);
  if (pagesThreads.get(threadId) !== thread || thread.closing || thread.turn || thread.pending || !pagesRecord(operation) ||
      !/^[a-f0-9]{64}$/.test(operation.nonce) || !pagesId(operation.operationId) || !Number.isSafeInteger(operation.sequence) || operation.sequence < 1) {
    if (typeof operation?.nonce === "string" && /^[a-f0-9]{64}$/.test(operation.nonce)) await pagesInvoke("cancelPrepare", threadId, operation.nonce);
    throw new Error("Pica turn refused");
  }
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const pending = { ...operation, ready, resolveReady, turnId: null, expires: Date.now() + 30000 };
  thread.pending = pending;
  return pending;
}
async function pagesAwaitTurn(threadId, pending, turnId) {
  if (!pagesId(turnId)) throw new Error("Pica turn refused");
  const accepted = await Promise.race([pending.ready, new Promise((resolve) => setTimeout(() => resolve(false), Math.max(0, pending.expires - Date.now())))]);
  const thread = pagesThreads.get(threadId);
  if (!accepted || !thread || thread.pending !== pending || pending.turnId !== turnId || thread.turn?.id !== turnId) throw new Error("Pica readiness refused");
  thread.pending = null;
}
function pagesNativeOperation(threadId, pending) {
  const thread = pagesThreads.get(threadId);
  if (!thread || thread.closing || thread.pending !== pending || pending.expires < Date.now() ||
      !pagesId(pending.operationId) || !/^[a-f0-9]{64}$/.test(pending.nonce) ||
      !Number.isSafeInteger(pending.sequence) || pending.sequence < 1 ||
      !/^[a-f0-9]{64}$/.test(thread.context) || !pagesSize(thread.catalog, 1048576)) throw new Error("Pica operation refused");
  return { operationId: pending.operationId, nonce: pending.nonce, sequence: pending.sequence, context: thread.context, catalog: thread.catalog };
}
async function pagesCancelPending(threadId, pending) {
  const thread = pagesThreads.get(threadId);
  if (!thread || thread.pending !== pending) return;
  thread.pending = null;
  pending.resolveReady(false);
  await pagesInvoke("cancelPrepare", threadId, pending.nonce);
}
async function pagesRegistryReady(input) {
  if (!pagesRecord(input) || Object.keys(input).some((key) => !["requestId", "threadId", "turnId", "context", "catalog", "operationId", "nonce", "sequence"].includes(key)) ||
      !pagesId(input.requestId) || !pagesId(input.threadId) || !pagesId(input.turnId)) throw new Error("Pica readiness refused");
  const thread = pagesThreads.get(input.threadId);
  const pending = thread?.pending;
  if (!thread || thread.closing || !pending || pending.turnId || pending.expires < Date.now() ||
      input.operationId !== pending.operationId || input.nonce !== pending.nonce || input.sequence !== pending.sequence ||
      input.context !== thread.context || !pagesSize(input.catalog, 1048576) ||
      JSON.stringify(pagesCanonical(input.catalog)) !== JSON.stringify(pagesCanonical(thread.catalog))) throw new Error("Pica readiness refused");
  pending.turnId = input.turnId;
  const readyInput = { requestId: input.requestId, threadId: input.threadId, turnId: input.turnId, nonce: input.nonce, operationId: input.operationId, sequence: input.sequence, context: input.context, catalog: input.catalog };
  const admitted = await pagesInvoke("ready", readyInput);
  if (!pagesRecord(admitted) || JSON.stringify(pagesCanonical(admitted)) !== JSON.stringify(pagesCanonical({ ...readyInput, accepted: true }))) throw new Error("Pica readiness refused");
  if (pagesThreads.get(input.threadId) !== thread || thread.closing || thread.pending !== pending || pending.expires < Date.now()) {
    await pagesInvoke("cancelPrepare", input.threadId, pending.nonce);
    throw new Error("Pica readiness refused");
  }
  thread.turn = { id: input.turnId, operationId: input.operationId, nonce: input.nonce, sequence: input.sequence };
  pending.resolveReady(true);
  return admitted;
}
async function pagesThreadInvalidated(input) {
  if (!pagesRecord(input) || Object.keys(input).length !== 3 ||
      Object.keys(input).some((key) => !["requestId", "threadId", "context"].includes(key)) ||
      !pagesId(input.requestId) || !pagesId(input.threadId) ||
      typeof input.context !== "string" || !/^[a-f0-9]{64}$/.test(input.context)) throw new Error("Pica invalidation refused");
  const thread = pagesThreads.get(input.threadId);
  if (!thread) {
    const binding = pagesBindings.get(input.threadId) || pagesRetiredBindings.get(input.threadId);
    if (binding) {
      if (binding.context !== input.context) throw new Error("Pica invalidation refused");
      binding.invalidated = true;
      pagesInvalidatedContexts.add(input.context);
      await pagesCloseBinding(input.threadId, binding);
      return { requestId: input.requestId, threadId: input.threadId, context: input.context, closed: true };
    }
    if (input.context !== pagesIssuedContext) throw new Error("Pica invalidation refused");
    let early = pagesEarlyInvalidations.get(input.context);
    if (!early) {
      early = { threadId: input.threadId, error: new Error("Pica invalidation unavailable") };
      pagesEarlyInvalidations.set(input.context, early);
      pagesInvalidatedContexts.add(input.context);
    }
    if (early.threadId !== input.threadId) throw new Error("Pica invalidation refused");
    throw early.error;
  }
  if (thread.context !== input.context) throw new Error("Pica invalidation refused");
  pagesInvalidatedContexts.add(input.context);
  await pagesCloseThread(input.threadId);
  return { requestId: input.requestId, threadId: input.threadId, context: input.context, closed: true };
}
async function pagesRegistryRevoked(input) {
  if (!pagesRecord(input) || Object.keys(input).some((key) => !["requestId", "threadId", "turnId", "context", "catalog", "operationId", "nonce", "sequence"].includes(key)) ||
      !pagesId(input.requestId) || !pagesId(input.threadId) || !pagesId(input.turnId)) throw new Error("Pica revoke refused");
  const thread = pagesThreads.get(input.threadId);
  const operation = thread?.pending || thread?.turn;
  if (!thread || !operation || operation.operationId !== input.operationId || operation.nonce !== input.nonce || operation.sequence !== input.sequence ||
      ((operation.turnId || operation.id) && (operation.turnId || operation.id) !== input.turnId) || thread.context !== input.context || !pagesSize(input.catalog, 1048576) ||
      JSON.stringify(pagesCanonical(input.catalog)) !== JSON.stringify(pagesCanonical(thread.catalog))) throw new Error("Pica revoke refused");
  if (thread.pending) { thread.pending.resolveReady(false); thread.pending = null; }
  thread.turn = null;
  const result = await pagesInvoke("revoke", input);
  if (!pagesRecord(result) || JSON.stringify(pagesCanonical(result)) !== JSON.stringify(pagesCanonical({ ...input, accepted: true }))) throw new Error("Pica revoke refused");
  return result;
}
async function pagesEndTurn(threadId, turnId) {
  const thread = pagesThreads.get(threadId);
  if (!thread || thread.turn?.id !== turnId) return;
  thread.turn = null;
  await pagesInvoke("endTurn", threadId, turnId);
}
async function pagesCloseThread(threadId) {
  const thread = pagesThreads.get(threadId);
  if (!thread) return;
  if (thread.closePromise) return thread.closePromise;
  thread.closing = true;
  const pending = thread.pending;
  thread.pending = null;
  thread.turn = null;
  if (pending) pending.resolveReady(false);
  // Pages close revokes the prepared or active turn before settling in-flight calls.
  const closePromise = pagesInvoke("closeThread", threadId);
  thread.closePromise = closePromise;
  return closePromise;
}
function pagesResult(result) {
  if (!pagesRecord(result) || Object.keys(result).some((key) => !["success", "text", "images"].includes(key)) ||
      typeof result.success !== "boolean" || typeof result.text !== "string" || Buffer.byteLength(result.text, "utf8") > 1048576 ||
      !Array.isArray(result.images) || result.images.length > 4) throw new Error("Pica result refused");
  const contentItems = [{ type: "inputText", text: result.text }];
  for (const image of result.images) {
    if (!pagesRecord(image) || Object.keys(image).some((key) => !["mimeType", "data"].includes(key)) ||
        !["image/png", "image/jpeg"].includes(image.mimeType) || typeof image.data !== "string" ||
        image.data.length < 4 || image.data.length > 8000000 || image.data.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) throw new Error("Pica image refused");
    const bytes = Buffer.from(image.data, "base64");
    const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((image.mimeType === "image/png" && !png) || (image.mimeType === "image/jpeg" && !jpeg)) throw new Error("Pica image refused");
    contentItems.push({ type: "inputImage", imageUrl: "data:" + image.mimeType + ";base64," + image.data });
  }
  return { success: result.success, contentItems };
}
async function pagesCall(input) {
  if (!pagesRecord(input) || Object.keys(input).some((key) => !["threadId", "turnId", "callId", "tool", "arguments", "namespace"].includes(key)) || !pagesId(input.threadId) || !pagesId(input.turnId) || !pagesId(input.callId) ||
      typeof input.tool !== "string" || !pagesRecord(input.arguments) || !pagesSize(input.arguments, 1048576) ||
      (input.namespace !== undefined && input.namespace !== null)) throw new Error("Pica call refused");
  const thread = pagesThreads.get(input.threadId);
  if (thread?.closing) throw new Error("Pica thread closed");
  const turn = thread?.turn;
  if (!thread || !turn || turn.id !== input.turnId || !thread.names.has(input.tool) || thread.calls.has(input.callId) || thread.calls.size >= 4096) throw new Error("Pica call refused");
  thread.calls.add(input.callId);
  const result = await pagesInvoke("dispatch", { threadId: input.threadId, turnId: input.turnId, callId: input.callId, tool: input.tool, arguments: input.arguments, operationId: turn.operationId, nonce: turn.nonce, sequence: turn.sequence });
  if (pagesThreads.get(input.threadId) !== thread || thread.turn !== turn) throw new Error("Pica turn ended");
  return pagesResult(result);
}
`;
