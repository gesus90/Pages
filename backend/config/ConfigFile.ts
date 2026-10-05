import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "smol-toml";

import { ConfigError, readPagesConfig, writePagesConfig } from "./PagesConfig";

import type { TomlTable } from "smol-toml";
import type { PagesConfig } from "./PagesConfig";

const FILE_HEADER = `# Pages configuration.
# Start parameters such as --port override these values.
# Pages rewrites this file when the setup finishes or a setting changes.
`;

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Reads and writes the TOML configuration file of a Pages instance.
 *
 * @remarks
 * Every write starts from the file as it is on disk, so values an operator
 * added by hand stay in place. Writes go to a temporary file that replaces
 * the configuration in one rename, so a crash never leaves half a file.
 * Comments are not kept when Pages rewrites the file.
 */
export class ConfigFile {
  private readonly filePath: string;

  /**
   * Creates access to one configuration file.
   *
   * @param filePath - Absolute path of `config.toml`.
   */
  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Absolute path of the configuration file. */
  public get path(): string {
    return this.filePath;
  }

  /**
   * Reads the configuration.
   *
   * @returns The configuration, or `null` when the file does not exist.
   * @throws {ConfigError} When the file is unreadable, no valid TOML, or
   * holds invalid values. The file is never changed in that case.
   */
  public async read(): Promise<PagesConfig | null> {
    const document = await this.readDocument();

    return document === null ? null : readPagesConfig(document, this.filePath);
  }

  /**
   * Stores a configuration, keeping every other key of the file.
   *
   * @param config - Settings to store.
   * @throws {ConfigError} When the current file cannot be read or the new
   * one cannot be written.
   */
  public async write(config: PagesConfig): Promise<void> {
    const document = (await this.readDocument()) ?? {};

    await this.replaceFile(stringify(writePagesConfig(document, config)));
  }

  /**
   * Changes the stored configuration based on its current content.
   *
   * @param change - Derives the new configuration from the stored one.
   * @returns The stored configuration after the change.
   * @throws {ConfigError} When the file is missing, invalid, or cannot be
   * written.
   */
  public async update(
    change: (current: PagesConfig) => PagesConfig,
  ): Promise<PagesConfig> {
    const current = await this.read();

    if (current === null) {
      throw new ConfigError(
        `The configuration file "${this.filePath}" does not exist.`,
      );
    }

    const next = change(current);

    await this.write(next);

    return next;
  }

  private async readDocument(): Promise<TomlTable | null> {
    let text: string;

    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new ConfigError(
        `The configuration file "${this.filePath}" cannot be read.`,
        { cause: error },
      );
    }

    try {
      return parse(text);
    } catch (error: unknown) {
      throw new ConfigError(
        `The configuration file "${this.filePath}" is not valid TOML. Fix or remove it and start Pages again.`,
        { cause: error },
      );
    }
  }

  private async replaceFile(content: string): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomBytes(6).toString("hex")}.tmp`,
    );

    try {
      await mkdir(directory, {
        mode: PRIVATE_DIRECTORY_MODE,
        recursive: true,
      });
      await writeFile(temporaryPath, `${FILE_HEADER}\n${content}`, {
        flag: "wx",
        mode: PRIVATE_FILE_MODE,
      });
      await rename(temporaryPath, this.filePath);
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true });

      throw new ConfigError(
        `The configuration file "${this.filePath}" cannot be written.`,
        { cause: error },
      );
    }
  }
}
