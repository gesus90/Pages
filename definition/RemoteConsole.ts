import { z } from "zod";

import { setupProgressSchema } from "./RemoteSetup";

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
  /** Where the shell started, once known; the login directory of a connection console. */
  directory: z.string().max(4096).nullable(),
  /** The progress of a guided setup run; `null` for an ordinary shell. */
  setup: setupProgressSchema.nullable(),
});

/** State displayed above the terminal. */
export type RemoteConsoleState = z.infer<typeof consoleStateSchema>;

/** Sequenced events allow an interrupted channel to resume without repeating input. */
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
  /** Output up to `sequence` is no longer kept; the replay continues after it. */
  z.object({ kind: z.literal("gap"), sequence: z.number().int() }),
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

/** Longest input or paste fragment of one channel message. */
export const CONSOLE_INPUT_FRAGMENT = 8192;

/**
 * Browser-to-server messages of the console channel: ordered input bound to
 * the shell attempt, geometry, and how much output the terminal processed.
 */
export const consoleCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input"),
    attempt: z.number().int().min(0).max(CONSOLE_MAXIMUM_RETRIES),
    data: z.string().min(1).max(CONSOLE_INPUT_FRAGMENT),
  }),
  consoleSizeSchema.extend({ type: z.literal("resize") }),
  z.object({
    type: z.literal("ack"),
    characters: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024),
  }),
]);

/** One browser-to-server message of the console channel. */
export type RemoteConsoleCommand = z.infer<typeof consoleCommandSchema>;
