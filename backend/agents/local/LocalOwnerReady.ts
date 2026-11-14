import { watch } from "node:fs/promises";
import path from "node:path";

import { localOwnerProofSchema } from "./LocalSessionContracts";
import { readLocalRecord } from "./LocalSessionFiles";

/** Waits for a local owner to write its readiness proof. */
export async function waitForLocalOwnerReady(directory: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const events = watch(directory, { signal: controller.signal });
    try {
      localOwnerProofSchema.parse(
        await readLocalRecord(path.join(directory, "proof.json")),
      );
      await readLocalRecord(path.join(directory, "ready.json"));
      return;
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    for await (const event of events) {
      if (event.filename === "ready.json") return;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
