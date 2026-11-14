import { z } from "zod";

/** Numeric storage facts only; provider contents and connection identities never enter events. */
export const storageUsageSchema = z.strictObject({
  totalBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
  largestDirectoryBytes: z.array(z.number().int().nonnegative()).max(5),
});

/** Size snapshot delivered to automations and durable Pages event readers. */
export type StorageUsage = z.infer<typeof storageUsageSchema>;
