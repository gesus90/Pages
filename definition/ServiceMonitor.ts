import { z } from "zod";

/** Persisted restart evidence contains only unit names, counters and observation times. */
export const serviceMonitorStateSchema = z.object({
  checkedAt: z.number().int().nonnegative(),
  units: z.array(
    z.object({
      unit: z.string().regex(/^[a-zA-Z0-9@_.-]+\.service$/u),
      restarts: z.number().int().nonnegative(),
      events: z.array(
        z.object({
          at: z.number().int().nonnegative(),
          count: z.number().int().positive(),
        }),
      ),
    }),
  ),
  warnings: z.array(
    z.object({
      unit: z.string(),
      count: z.number().int().positive(),
      detectedAt: z.number().int().nonnegative(),
    }),
  ),
});

/** Internal monitor checkpoint; never sent to clients in full. */
export type ServiceMonitorState = z.infer<typeof serviceMonitorStateSchema>;

/** Administrator-visible health of the independent detector and retained restart warnings. */
export interface ServiceMonitorStatus {
  readonly state: "ok" | "unavailable" | "stale";
  readonly checkedAt: number | null;
  readonly warnings: ServiceMonitorState["warnings"];
}
