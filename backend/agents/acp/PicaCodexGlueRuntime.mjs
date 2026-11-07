/* Pages-owned private ACP client for the Pica Codex adapter. */
const method = Object.freeze({
  catalog: "_pages/pica/catalog",
  bindThread: "_pages/pica/bind_thread",
  prepare: "_pages/pica/prepare",
  ready: "_pages/pica/ready",
  revoke: "_pages/pica/revoke",
  cancelPrepare: "_pages/pica/cancel_prepare",
  endTurn: "_pages/pica/end_turn",
  closeThread: "_pages/pica/close_thread",
  dispatch: "_pages/pica/dispatch",
  chunk: "_pages/pica/chunk",
});
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) =>
  record(value) && Object.keys(value).every((key) => allowed.includes(key));
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
const refuse = () => {
  throw new Error("Pica response refused");
};

async function imageData(request, call, receipt, images) {
  const output = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (
      !keys(image, ["mimeType", "length"]) ||
      !["image/png", "image/jpeg"].includes(image.mimeType) ||
      !Number.isSafeInteger(image.length) ||
      image.length < 4 ||
      image.length > 8000000 ||
      image.length % 4 !== 0
    )
      refuse();
    let data = "";
    while (data.length < image.length) {
      const chunk = await request(method.chunk, {
        threadId: call.threadId,
        turnId: call.turnId,
        callId: call.callId,
        operationId: call.operationId,
        nonce: call.nonce,
        sequence: call.sequence,
        receipt,
        image: index,
        offset: data.length,
      });
      if (
        !keys(chunk, ["data", "next"]) ||
        typeof chunk.data !== "string" ||
        chunk.data.length < 1 ||
        chunk.data.length > 524288 ||
        chunk.next !== data.length + chunk.data.length ||
        chunk.next > image.length
      )
        refuse();
      data += chunk.data;
    }
    output.push({ mimeType: image.mimeType, data });
  }
  return output;
}

/** Creates a private client using the adapter's actual ACP request callback. */
export function createPicaCodexGlue(request) {
  if (typeof request !== "function") refuse();
  let policyContext = null;
  let tail = Promise.resolve();
  let pending = 0;
  let generation = 0;
  function enqueue(action) {
    if (pending >= 32) refuse();
    const current = generation;
    const deadline = Date.now() + 60000;
    pending += 1;
    const next = tail.then(() => {
      if (generation !== current || Date.now() > deadline) refuse();
      return action();
    });
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next.finally(() => {
      pending -= 1;
    });
  }
  return {
    async catalog() {
      const result = await request(method.catalog, {});
      if (
        !keys(result, ["tools", "context"]) ||
        !Array.isArray(result.tools) ||
        typeof result.context !== "string" ||
        !/^[a-f0-9]{64}$/.test(result.context)
      )
        refuse();
      policyContext = result.context;
      return result.tools;
    },
    async policyContext() {
      if (typeof policyContext !== "string") refuse();
      return policyContext;
    },
    async bindThread(threadId, context) {
      if (
        !id(threadId) ||
        typeof context !== "string" ||
        context !== policyContext ||
        !/^[a-f0-9]{64}$/.test(context)
      )
        refuse();
      const result = await request(method.bindThread, { threadId, context });
      if (!keys(result, ["accepted"]) || typeof result.accepted !== "boolean")
        refuse();
      const accepted = result.accepted;
      if (accepted) policyContext = null;
      return accepted;
    },
    async prepare(threadId) {
      if (!id(threadId)) refuse();
      const result = await request(method.prepare, { threadId });
      if (
        !keys(result, ["nonce", "operationId", "sequence"]) ||
        typeof result.nonce !== "string" ||
        !/^[a-f0-9]{64}$/.test(result.nonce) ||
        typeof result.operationId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(result.operationId) ||
        !Number.isSafeInteger(result.sequence) ||
        result.sequence < 1
      )
        refuse();
      generation += 1;
      return result;
    },
    async ready(input) {
      const result = await request(method.ready, input);
      if (!record(result) || result.accepted !== true) refuse();
      return result;
    },
    async revoke(input) {
      generation += 1;
      const result = await request(method.revoke, input);
      if (!record(result) || result.accepted !== true) refuse();
      return result;
    },
    async cancelPrepare(threadId, nonce) {
      generation += 1;
      const result = await request(method.cancelPrepare, { threadId, nonce });
      return keys(result, ["cancelled"]) && result.cancelled === true;
    },
    async endTurn(threadId, turnId) {
      if (!id(threadId) || !id(turnId)) refuse();
      generation += 1;
      const result = await request(method.endTurn, { threadId, turnId });
      if (!keys(result, ["ended"]) || result.ended !== true) refuse();
    },
    async closeThread(threadId) {
      if (!id(threadId)) refuse();
      generation += 1;
      const result = await request(method.closeThread, { threadId });
      if (!keys(result, ["closed"]) || result.closed !== true) refuse();
    },
    async dispatch(call) {
      if (
        !keys(call, [
          "threadId",
          "turnId",
          "callId",
          "tool",
          "arguments",
          "operationId",
          "nonce",
          "sequence",
        ]) ||
        !id(call.threadId) ||
        !id(call.turnId) ||
        !id(call.callId) ||
        typeof call.tool !== "string" ||
        !record(call.arguments)
      )
        refuse();
      return enqueue(async () => {
        const result = await request(method.dispatch, call);
        if (
          !keys(result, ["success", "text", "receipt", "images"]) ||
          typeof result.success !== "boolean" ||
          typeof result.text !== "string" ||
          Buffer.byteLength(result.text, "utf8") > 1048576 ||
          !Array.isArray(result.images) ||
          result.images.length > 4
        )
          refuse();
        if (result.images.length === 0 && result.receipt !== null) refuse();
        if (
          result.images.length > 0 &&
          (typeof result.receipt !== "string" ||
            !/^[0-9a-f-]{36}$/.test(result.receipt))
        )
          refuse();
        const images = result.images.length
          ? await imageData(request, call, result.receipt, result.images)
          : [];
        return { success: result.success, text: result.text, images };
      });
    },
  };
}
