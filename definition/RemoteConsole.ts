import { z } from "zod";

/** One reconnect series is bounded on both the server and the browser. */
export const CONSOLE_MAXIMUM_RETRIES = 10;

/** The browser receives classified errors and terminal output, never SSH credentials. */
export const consoleStateSchema = z.object({
  status: z.enum([
    "connecting",
    "connected",
    "reconnecting",
    "blocked",
    "ended",
  ]),
  attempts: z.number().int().min(0).max(CONSOLE_MAXIMUM_RETRIES),
  message: z.string().nullable(),
  exitCode: z.number().nullable(),
});

/** State displayed above the terminal. */
export type RemoteConsoleState = z.infer<typeof consoleStateSchema>;

/** Sequenced events allow an interrupted HTTP stream to resume without repeating input. */
export const consoleEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("output"),
    sequence: z.number().int(),
    chunk: z.string(),
  }),
  z.object({
    kind: z.literal("state"),
    sequence: z.number().int(),
    state: consoleStateSchema,
  }),
]);

/** Server-to-browser terminal event. */
export type RemoteConsoleEvent = z.infer<typeof consoleEventSchema>;

/** Bounded geometry accepted by both the route and transport. */
export const consoleSizeSchema = z.object({
  columns: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(300),
});

/** Columns and rows, independent of pixel density. */
export type RemoteConsoleSize = z.infer<typeof consoleSizeSchema>;
