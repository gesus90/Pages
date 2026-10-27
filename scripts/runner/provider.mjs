import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** Replaces private storage atomically without following a destination symlink. */
async function storePrivate(destination, contents, directory) {
  const temporary = await mkdtemp(join(directory, ".private-"));
  try {
    const pending = join(temporary, "contents");
    await writeFile(pending, JSON.stringify(contents), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(pending, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Calls only the fixed provider origin; upstream bodies never become diagnostics. */
async function providerRequest(path, apiKey, body) {
  const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const failure = new Error("OpenRouter request failed");
    failure.upstreamStatus = response.status;
    throw failure;
  }
  return response;
}

/** A figure the provider stated as a finite, non-negative number; anything else stays unknown. */
function statedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Key usage as the provider states it; a field it omits stays unknown, never zero. */
function keyUsage(body) {
  const data = body?.data;
  return {
    used: statedNumber(data?.usage),
    limit: statedNumber(data?.limit),
    remaining: statedNumber(data?.limit_remaining),
    resets: ["daily", "weekly", "monthly"].includes(data?.limit_reset)
      ? data.limit_reset
      : null,
  };
}

/** Validates authentication separately because the public model catalog cannot prove it. */
async function checkProviderKey(apiKey) {
  const response = await providerRequest("key", apiKey);
  try {
    return keyUsage(await response.json());
  } catch {
    return keyUsage(null);
  }
}

/** Keeps only catalog metadata and identifies free prompt and completion prices explicitly. */
function catalogModel(model, apiKey) {
  if (
    typeof model?.id !== "string" ||
    !/^[a-zA-Z0-9/~_.:+-]{1,200}$/.test(model.id) ||
    typeof model.name !== "string" ||
    model.name.length > 300 ||
    model.name.includes(apiKey) ||
    model.id.includes(apiKey)
  )
    throw new Error("Invalid OpenRouter catalog");
  const limit = (figure) =>
    Number.isSafeInteger(figure) && figure > 0 ? figure : null;
  const prices = [model.pricing?.prompt, model.pricing?.completion];
  const isFree = prices.every(
    (price) =>
      typeof price === "string" && price.trim() !== "" && Number(price) === 0,
  );
  return {
    id: model.id,
    name: model.name,
    isFree,
    ...(Array.isArray(model.architecture?.input_modalities)
      ? {
          supportsImages: model.architecture.input_modalities.includes("image"),
        }
      : {}),
    contextLength: limit(model.context_length),
    maxOutputTokens: limit(model.top_provider?.max_completion_tokens),
  };
}

/** The catalog entry Pages receives; limits the provider did not state are unknown. */
function listedModel(model) {
  return {
    id: model.id,
    name: model.name,
    ...(typeof model.supportsImages === "boolean"
      ? { supportsImages: model.supportsImages }
      : {}),
    contextLength: model.contextLength ?? null,
    maxOutputTokens: model.maxOutputTokens ?? null,
  };
}

/** Validates a new key and catalog before replacing the previous provider configuration. */
async function syncProvider(apiKey, directory) {
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{16,512}$/.test(apiKey))
    throw new Error("Invalid provider credential");
  const usage = await checkProviderKey(apiKey);
  const response = await providerRequest("models", apiKey);
  const catalog = await response.json();
  if (!Array.isArray(catalog?.data) || catalog.data.length > 10000)
    throw new Error("Invalid OpenRouter catalog");
  const models = catalog.data.map((model) => catalogModel(model, apiKey));
  const syncedAt = new Date().toISOString();
  const freeModels = models.filter((model) => model.isFree).map(listedModel);
  if (freeModels.length > 1000) throw new Error("Invalid OpenRouter catalog");
  await storePrivate(
    join(directory, "openrouter.json"),
    { apiKey, models, syncedAt },
    directory,
  );
  return {
    operation: "sync",
    ok: true,
    keyStatus: 200,
    totalModels: models.length,
    freeModels,
    syncedAt,
    usage,
  };
}

/** Checks the stored credential and sends a bounded prompt using a synchronized free model. */
async function checkProvider(model, directory) {
  const stored = JSON.parse(
    await readFile(join(directory, "openrouter.json"), "utf8"),
  );
  if (!stored.models.some((entry) => entry.id === model && entry.isFree))
    throw new Error("Synchronized free model required");
  const usage = await checkProviderKey(stored.apiKey);
  const response = await providerRequest("chat/completions", stored.apiKey, {
    model,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    max_tokens: 64,
  });
  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  return {
    operation: "check",
    ok: true,
    keyStatus: 200,
    chatStatus: 200,
    model,
    hasReply: typeof content === "string" && content.trim().length > 0,
    isOkReply: typeof content === "string" && content.trim() === "OK",
    usage,
  };
}

/** Returns allowlisted status fields only, including on provider or storage failures. */
export async function handleProvider(message, channel, directory) {
  let result;
  try {
    if (message.operation === "sync") {
      const apiKey =
        message.apiKey ??
        JSON.parse(await readFile(join(directory, "openrouter.json"), "utf8"))
          .apiKey;
      result = await syncProvider(apiKey, directory);
    } else if (message.operation === "check")
      result = await checkProvider(message.model, directory);
    else if (message.operation === "catalog") {
      const stored = JSON.parse(
        await readFile(join(directory, "openrouter.json"), "utf8"),
      );
      result = {
        operation: "catalog",
        ok: true,
        syncedAt: stored.syncedAt,
        freeModels: stored.models
          .filter((entry) => entry.isFree)
          .map(listedModel),
      };
    } else throw new Error("Unsupported provider operation");
  } catch (error) {
    result = {
      operation: "failed",
      ok: false,
      upstreamStatus: Number.isInteger(error.upstreamStatus)
        ? error.upstreamStatus
        : null,
    };
  }
  if (channel.readyState === WebSocket.OPEN)
    channel.send(
      JSON.stringify({
        version: 1,
        type: "openrouter-result",
        requestId: message.requestId,
        result,
      }),
    );
}
