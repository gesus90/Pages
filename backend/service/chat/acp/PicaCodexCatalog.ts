import { z } from "zod";

import { invokePicaTool } from "./PicaToolClient";

import type { PicaCodexTool } from "@/backend/agents/acp/PicaCodexGlue";
import type { PicaToolClientBinding } from "./PicaToolClient";

const catalog = z
  .object({
    tools: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
            description: z.string().min(1).max(10_000),
            access: z.enum(["user", "administrator"]),
            inputSchema: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(512),
  })
  .strict();

/** Reads the catalog through the same authenticated turn-bound HTTP route. */
export async function readPicaCodexCatalog(
  binding: PicaToolClientBinding,
  signal: AbortSignal,
): Promise<readonly PicaCodexTool[]> {
  const text = await invokePicaTool(
    binding,
    JSON.stringify({ action: "catalog" }),
    signal,
  );
  const parsed = catalog.parse(JSON.parse(text));
  return parsed.tools.map(({ id, description, inputSchema }) => ({
    name: id,
    description,
    inputSchema,
  }));
}
