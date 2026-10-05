import path from "node:path";

import { isValidPort } from "./PagesConfig";

/** Settings given as start parameters; they override the configuration file. */
export interface StartOptions {
  /** Port to listen on, or `null` to use the configured one. */
  readonly port: number | null;
  /** Absolute configuration file path, or `null` for the default location. */
  readonly configPath: string | null;
}

/** Raised when the start parameters cannot be understood. */
export class StartOptionsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StartOptionsError";
  }
}

/** Explains the start parameters Pages understands. */
export const START_USAGE = `Usage: pnpm start [--port <number>] [--config <path>]

  --port <number>   Port to listen on. Pages stores it in the configuration.
  --config <path>   Configuration file to use instead of ~/.pages/config.toml.`;

const OPTION = {
  CONFIG: "--config",
  PORT: "--port",
} as const;

type OptionName = (typeof OPTION)[keyof typeof OPTION];

function isOptionName(value: string): value is OptionName {
  return value === OPTION.CONFIG || value === OPTION.PORT;
}

function parsePort(value: string): number {
  const port = /^\d+$/u.test(value) ? Number(value) : Number.NaN;

  if (!isValidPort(port)) {
    throw new StartOptionsError(
      `"${value}" is no valid port. Use a whole number from 1 to 65535.`,
    );
  }

  return port;
}

function parseConfigPath(value: string): string {
  if (value.trim() === "") {
    throw new StartOptionsError(`${OPTION.CONFIG} needs a file path.`);
  }

  return path.resolve(value);
}

/**
 * Takes the next option off the remaining arguments.
 *
 * @param argument - `--name=value` or `--name`.
 * @param remaining - Arguments still to read, last one first; the value of
 * `--name value` is taken off it.
 */
function takeOption(
  argument: string,
  remaining: string[],
): { readonly name: OptionName; readonly value: string } {
  const separatorIndex = argument.indexOf("=");
  const name =
    separatorIndex === -1 ? argument : argument.slice(0, separatorIndex);

  if (!isOptionName(name)) {
    throw new StartOptionsError(`Unknown start parameter "${argument}".`);
  }

  if (separatorIndex !== -1) {
    return { name, value: argument.slice(separatorIndex + 1) };
  }

  const value = remaining.pop();

  if (value === undefined) {
    throw new StartOptionsError(`${name} needs a value.`);
  }

  return { name, value };
}

/**
 * Reads the start parameters.
 *
 * @param argumentList - Command-line arguments after the script name.
 * @returns The given settings.
 * @throws {StartOptionsError} For unknown parameters or invalid values.
 */
export function parseStartOptions(
  argumentList: readonly string[],
): StartOptions {
  const remaining = [...argumentList].reverse();
  let port: number | null = null;
  let configPath: string | null = null;
  let argument = remaining.pop();

  while (argument !== undefined) {
    const option = takeOption(argument, remaining);

    if (option.name === OPTION.PORT) {
      port = parsePort(option.value);
    } else {
      configPath = parseConfigPath(option.value);
    }

    argument = remaining.pop();
  }

  return { configPath, port };
}
