import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { logCaughtError } from "@/backend/logging/Logger";

import type { Readable } from "node:stream";

/** Stills one reading of a video returns at most. */
export const VIDEO_FRAME_COUNT = 4;

/** How long one call of the video tool may take. */
const COMMAND_TIMEOUT_MILLISECONDS = 30_000;

/** Width in pixels a still has at most. */
const FRAME_WIDTH = 1024;

/** Runs a program with arguments and returns its standard output. */
export type VideoCommandRunner = (
  program: string,
  args: readonly string[],
) => Promise<string>;

/** Reads stills of a video in even intervals. */
export interface ConversationVideoFrameReader {
  /**
   * Reads the stills of one video.
   * @param open - Opens the stored video from its start.
   * @param durationSeconds - The length the browser read, when known.
   * @returns The stills as JPEG in their order, or `null` when the server has
   * no tool to read videos or the video cannot be read.
   */
  frames(
    open: () => Readable,
    durationSeconds: number | null,
  ): Promise<Buffer[] | null>;
}

function runCommand(program: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      [...args],
      { timeout: COMMAND_TIMEOUT_MILLISECONDS, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

/** The moments of the stills: evenly spread, never the very first or last frame. */
export function frameMoments(durationSeconds: number, count: number): number[] {
  if (!(durationSeconds > 0)) return [0];
  return Array.from(
    { length: count },
    (_, index) => (durationSeconds * (index + 1)) / (count + 1),
  );
}

/**
 * Reads stills of a video with `ffmpeg` and `ffprobe` of the server, when
 * they are installed.
 * @remarks
 * The video is copied to a private temporary directory, read with fixed
 * arguments and removed again; nothing of the file is run. Without the tools
 * the reader answers `null`, and the caller falls back to the preview image.
 */
export class FfmpegVideoFrameReader implements ConversationVideoFrameReader {
  private readonly run: VideoCommandRunner;

  /**
   * Creates the reader.
   * @param run - Runs a program; `execFile` with a time limit by default.
   */
  public constructor(run: VideoCommandRunner = runCommand) {
    this.run = run;
  }

  /** Copies the video aside and reads its stills. */
  public async frames(
    open: () => Readable,
    durationSeconds: number | null,
  ): Promise<Buffer[] | null> {
    const directory = await mkdtemp(path.join(tmpdir(), "pages-video-"));
    try {
      const input = path.join(directory, "video");
      await pipeline(open(), createWriteStream(input, { mode: 0o600 }));
      const duration = durationSeconds ?? (await this.duration(input));
      const frames: Buffer[] = [];
      for (const [index, moment] of frameMoments(
        duration,
        VIDEO_FRAME_COUNT,
      ).entries()) {
        const output = path.join(directory, `frame-${String(index)}.jpg`);
        await this.run("ffmpeg", [
          "-nostdin",
          "-loglevel",
          "error",
          "-ss",
          moment.toFixed(3),
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          `scale='min(${String(FRAME_WIDTH)},iw)':-2`,
          "-f",
          "image2",
          "-c:v",
          "mjpeg",
          output,
        ]);
        frames.push(await readFile(output));
      }
      return frames;
    } catch (error: unknown) {
      logCaughtError("ConversationVideoFrames", error);
      return null;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async duration(input: string): Promise<number> {
    const output = await this.run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      input,
    ]);
    const seconds = Number.parseFloat(output.trim());
    return Number.isFinite(seconds) ? seconds : 0;
  }
}
