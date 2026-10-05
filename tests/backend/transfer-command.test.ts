import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runTransferCommand,
  TRANSFER_EXIT_CODE,
} from "@/backend/database/legacy/TransferCommand";

import {
  createLegacyDatabase,
  fillLegacyDatabase,
} from "../helpers/legacy-sqlite";

interface RecordedOutput {
  readonly errors: string[];
  readonly lines: string[];
  readonly output: { log(message: string): void; error(message: string): void };
}

function createOutput(): RecordedOutput {
  const lines: string[] = [];
  const errors: string[] = [];

  return {
    errors,
    lines,
    output: {
      error: (message) => errors.push(message),
      log: (message) => lines.push(message),
    },
  };
}

describe("runTransferCommand", () => {
  let directory: string;
  let sourcePath: string;
  let targetPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-command-"));
    sourcePath = path.join(directory, "pages.db");
    targetPath = path.join(directory, "pages.duckdb");
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  describe("usage", () => {
    it.each([
      ["no arguments", []],
      ["a missing target", ["--source", "pages.db"]],
      ["a missing source", ["--target", "pages.duckdb"]],
      ["an unknown flag", ["--source", "a", "--target", "b", "--force", "1"]],
      ["a flag without a value", ["--source", "a", "--target"]],
      ["an unexpected positional argument", ["pages.db"]],
    ])("explains the usage for %s", async (_label, argv) => {
      const { errors, lines, output } = createOutput();

      await expect(runTransferCommand(argv, output)).resolves.toBe(
        TRANSFER_EXIT_CODE.USAGE,
      );
      expect(errors.join("\n")).toContain("Usage: pnpm db:transfer");
      expect(lines).toEqual([]);
    });

    it("refuses the same file as source and target", async () => {
      const { errors, output } = createOutput();

      await expect(
        runTransferCommand(
          ["--source", sourcePath, "--target", sourcePath],
          output,
        ),
      ).resolves.toBe(TRANSFER_EXIT_CODE.USAGE);
      expect(errors.join("\n")).toContain("Usage: pnpm db:transfer");
    });
  });

  describe("transferring", () => {
    function createSource(): void {
      const legacy = createLegacyDatabase(sourcePath);

      fillLegacyDatabase(legacy);
      legacy.close();
    }

    it("reports the row counts and succeeds", async () => {
      createSource();
      const { errors, lines, output } = createOutput();

      await expect(
        runTransferCommand(
          ["--source", sourcePath, "--target", targetPath],
          output,
        ),
      ).resolves.toBe(TRANSFER_EXIT_CODE.SUCCESS);

      expect(errors).toEqual([]);
      expect(lines.some((line) => /^users\s+2 ->\s+2$/u.test(line))).toBe(true);
      expect(lines.at(-1)).toBe("Transfer finished: every row count matches.");
    });

    it("says so when a repeated transfer has nothing to do", async () => {
      createSource();
      const arguments_ = ["--source", sourcePath, "--target", targetPath];

      await runTransferCommand(arguments_, createOutput().output);
      const { lines, output } = createOutput();

      await expect(runTransferCommand(arguments_, output)).resolves.toBe(
        TRANSFER_EXIT_CODE.SUCCESS,
      );
      expect(lines.at(-1)).toContain("Nothing to do");
    });

    it("reports a problem with the source in plain words", async () => {
      const { errors, output } = createOutput();

      await expect(
        runTransferCommand(
          ["--source", sourcePath, "--target", targetPath],
          output,
        ),
      ).resolves.toBe(TRANSFER_EXIT_CODE.FAILED);
      expect(errors).toEqual([
        `The SQLite file "${sourcePath}" does not exist.`,
      ]);
    });

    it("reports unexpected failures with their cause", async () => {
      await writeFile(sourcePath, "this is not a database");
      const { errors, output } = createOutput();

      await expect(
        runTransferCommand(
          ["--source", sourcePath, "--target", targetPath],
          output,
        ),
      ).resolves.toBe(TRANSFER_EXIT_CODE.FAILED);
      expect(errors.join("\n")).toContain("The transfer failed:");
    });
  });
});
