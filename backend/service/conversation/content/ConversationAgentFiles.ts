import { constants, createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";
import {
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_ATTACHMENT_MAXIMUM_COUNT,
} from "@/definition/ConversationContent";

const COMPONENT = "ConversationAgentFiles";

/** A line that attaches a file: `![description](file:/absolute/path)`. */
const FILE_LINE =
  /^\s*!\[[^\]\n]{0,500}\]\(file:(?:\/\/)?(\/[^)\n]{1,4000})\)\s*$/u;
const FENCE = /^\s*(```|~~~)/u;

/**
 * The only places an answer may attach files from, relative to the home
 * directory of the account Pages runs as (PAGE-298, B1). `depth` is how many
 * directories below the root a file must lie at least: a Pica working
 * directory is `~/.pages/pica-sessions/<session>/`, so its files lie one
 * directory deeper than the root. Further places come only by ticket.
 */
export const AGENT_FILE_ROOTS: readonly {
  readonly segments: readonly string[];
  readonly depth: number;
}[] = [
  { segments: [".pages", "pica-sessions"], depth: 1 },
  { segments: ["Results"], depth: 0 },
];

/** File names that hold secrets by convention, whatever directory they lie in. */
const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".keystore", ".jks"];

/** The types the chat shows by content; every other file is a plain download. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".diff": "text/x-diff",
  ".patch": "text/x-diff",
  ".csv": "text/csv",
  ".html": "text/html",
  ".zip": "application/zip",
};

/** Why a file was not attached, as the message says it. */
export type AgentFileRefusal =
  | "notFound"
  | "notRegular"
  | "notReadable"
  | "tooLarge"
  | "credentials"
  | "notAllowed"
  | "storeFailed"
  | "tooMany";

const REFUSAL_TEXTS: Readonly<Record<AgentFileRefusal, string>> = {
  notFound: "Datei nicht gefunden",
  notRegular: "keine reguläre Datei",
  notReadable: "Datei nicht lesbar",
  tooLarge: "größer als 512 MB",
  credentials: "Ort mit Zugangsdaten",
  notAllowed: "Ort nicht freigegeben",
  storeFailed: "Speichern fehlgeschlagen",
  tooMany: "höchstens 10 Anhänge je Nachricht",
};

/** A file an answer attaches, checked and ready to be copied. */
export interface AgentFile {
  /** The resolved path the bytes are read from. */
  readonly path: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** The index of the line in {@link AgentFileSelection.lines} that named the file. */
  readonly lineIndex: number;
}

/** An answer of an agent without its file lines, and the files they named. */
export interface AgentFileSelection {
  /** The text without the lines of attached files; a refused line stays with its reason. */
  readonly text: string;
  readonly files: readonly AgentFile[];
  /** Every line of the answer; a refused line already carries its reason. */
  readonly lines: readonly string[];
}

/** A file line that stays in the text, with why its file was not attached. */
export function refusedFileLine(
  line: string,
  refusal: AgentFileRefusal,
): string {
  return `${line.trimEnd()} (Datei nicht angehängt: ${REFUSAL_TEXTS[refusal]})`;
}

/**
 * The text of an answer once its files are stored.
 *
 * @param selection - What {@link ConversationAgentFiles.select} returned.
 * @param failed - The selected files that could not be stored; their lines
 * stay with the reason `storeFailed`.
 * @returns The text without the lines of attached files.
 */
export function agentSelectionText(
  selection: Pick<AgentFileSelection, "lines" | "files">,
  failed: readonly AgentFile[] = [],
): string {
  const attached = new Set(selection.files.map((file) => file.lineIndex));
  const unstored = new Set(failed.map((file) => file.lineIndex));
  const lines: string[] = [];
  for (const [index, line] of selection.lines.entries()) {
    if (unstored.has(index)) lines.push(refusedFileLine(line, "storeFailed"));
    else if (!attached.has(index)) lines.push(line);
  }
  return lines.join("\n").trim();
}

/** Where the files of the machine lie that an answer must never attach. */
export interface AgentFileLocations {
  /** The home directory of the account Pages runs as. */
  readonly home: string;
}

function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** Whether a file name alone marks a secret: `.env`, `.env.*` but `.env.example`, or a key file. */
function isSecretName(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  if (name === ".env") return true;
  if (name.startsWith(".env.") && name !== ".env.example") return true;
  return SECRET_EXTENSIONS.some((extension) => name.endsWith(extension));
}

async function resolveExisting(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    // A directory that does not exist protects nothing; its plain path stays.
    return target;
  }
}

/**
 * The files of an agent's answer (PAGE-298).
 *
 * @remarks
 * An agent attaches a file with a line `![description](file:/absolute/path)`.
 * Pages takes a readable regular file up to 512 MB, at most ten per answer,
 * only from {@link AGENT_FILE_ROOTS}: a Pica working directory below
 * `~/.pages/pica-sessions/<session>/` or `~/Results/`, with no part below the
 * root that begins with a dot. The server process copies the file, so the
 * isolation of the agent session does not protect anything here. In
 * addition no file comes from a place that holds credentials: `~/Agents/`,
 * `~/.ssh/`, `~/.gnupg/`, `~/.config/pages-mcp/`, the configuration of Pages
 * (`~/.pages/*.toml`, `/etc/pages/`), files named `.env` or `.env.*` except
 * `.env.example`, and `*.pem`, `*.key`, `*.p12`, `*.keystore`, `*.jks`. The
 * path is resolved first, so a symbolic link cannot lead around the rule. A
 * line whose file is refused stays in the text with the reason. Lines inside
 * code blocks are text and attach nothing.
 */
export class ConversationAgentFiles {
  private readonly locations: AgentFileLocations;

  /**
   * Creates the reader of file lines.
   *
   * @param locations - The home directory; that of the process by default.
   */
  public constructor(locations: AgentFileLocations = { home: homedir() }) {
    this.locations = locations;
  }

  /**
   * Reads the file lines of an answer and checks their files.
   *
   * @param text - The answer of the agent.
   * @returns The text that remains and the files to attach, in their order.
   */
  public async select(text: string): Promise<AgentFileSelection> {
    const lines: string[] = [];
    const files: AgentFile[] = [];
    let isCode = false;
    for (const line of text.split("\n")) {
      if (FENCE.test(line)) isCode = !isCode;
      const target = isCode ? null : (FILE_LINE.exec(line)?.[1] ?? null);
      if (target === null) {
        lines.push(line);
        continue;
      }
      const checked =
        files.length >= CONVERSATION_ATTACHMENT_MAXIMUM_COUNT
          ? "tooMany"
          : await this.check(target);
      if (typeof checked === "string") {
        lines.push(refusedFileLine(line, checked));
        continue;
      }
      files.push({ ...checked, lineIndex: lines.length });
      lines.push(line);
    }
    return { text: agentSelectionText({ lines, files }), files, lines };
  }

  /**
   * Opens a checked file for the copy into the file store.
   *
   * @param file - A file {@link ConversationAgentFiles.select} returned.
   * @returns The bytes of the file.
   */
  public open(file: AgentFile): AsyncIterable<Uint8Array> {
    return createReadStream(file.path);
  }

  /** Checks one named file; the reason when it must not be attached. */
  private async check(
    target: string,
  ): Promise<Omit<AgentFile, "lineIndex"> | AgentFileRefusal> {
    const named = path.normalize(decodePath(target));
    let resolved: string;
    try {
      resolved = await realpath(named);
    } catch {
      return "notFound";
    }
    if ((await this.isCredentialPlace(named)) || isSecretName(named))
      return "credentials";
    if ((await this.isCredentialPlace(resolved)) || isSecretName(resolved))
      return "credentials";
    if (!(await this.isAllowedPlace(resolved))) return "notAllowed";
    try {
      const facts = await stat(resolved);
      if (!facts.isFile()) return "notRegular";
      if (facts.size > CONVERSATION_ATTACHMENT_MAXIMUM_BYTES) return "tooLarge";
      await access(resolved, constants.R_OK);
      return {
        path: resolved,
        name: path.basename(named).slice(0, 255),
        mimeType:
          MIME_TYPES[path.extname(named).toLowerCase()] ??
          "application/octet-stream",
        sizeBytes: facts.size,
      };
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      return "notReadable";
    }
  }

  /**
   * Whether a resolved path lies below one of {@link AGENT_FILE_ROOTS}, deep
   * enough, and without a hidden part below the root.
   */
  private async isAllowedPlace(resolved: string): Promise<boolean> {
    for (const root of AGENT_FILE_ROOTS) {
      const plain = path.join(this.locations.home, ...root.segments);
      for (const directory of new Set([plain, await resolveExisting(plain)])) {
        if (!isInside(directory, resolved)) continue;
        const parts = path.relative(directory, resolved).split(path.sep);
        if (parts.length <= root.depth) continue;
        if (parts.some((part) => part.startsWith("."))) continue;
        return true;
      }
    }
    return false;
  }

  /** Whether a path lies in a directory of credentials or is a configuration file of Pages. */
  private async isCredentialPlace(file: string): Promise<boolean> {
    const { home } = this.locations;
    const directories = [
      path.join(home, "Agents"),
      path.join(home, ".ssh"),
      path.join(home, ".gnupg"),
      path.join(home, ".config", "pages-mcp"),
      "/etc/pages",
    ];
    for (const directory of directories) {
      if (isInside(directory, file)) return true;
      if (isInside(await resolveExisting(directory), file)) return true;
    }
    const configuration = path.join(home, ".pages");
    const isConfigurationFile = (directory: string): boolean =>
      path.dirname(file) === directory && file.toLowerCase().endsWith(".toml");
    return (
      isConfigurationFile(configuration) ||
      isConfigurationFile(await resolveExisting(configuration))
    );
  }
}

/** A path may be written URL-encoded, as `file:` addresses are. */
function decodePath(target: string): string {
  if (!target.includes("%")) return target;
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
