import { z } from "zod";

/** The places a runner executes an agent: on this machine or on a remote runner. */
export const EXECUTION_LOCATIONS = ["local", "remote"] as const;

/** Where the runner of an agent executes it. */
export type ExecutionLocation = (typeof EXECUTION_LOCATIONS)[number];

/**
 * Validates the execution location a card's data names.
 * @remarks
 * The location belongs to the runner, never to a provider, an API key, an
 * access or a plan. Data without it does not prove a location.
 */
export const executionLocationSchema = z.enum(EXECUTION_LOCATIONS);
