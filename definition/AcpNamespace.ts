import { z } from "zod";

import type { AcpNamespaceOwner } from "./AcpResource";

/** Validates persisted supervisor metadata before it can authorize recovery. */
export function readOwnedNamespace(input: unknown): AcpNamespaceOwner {
  return z
    .strictObject({
      pid: z.number().int().positive(),
      uid: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      boot: z.uuid(),
      unit: z.string().max(200).optional(),
    })
    .parse(input);
}
