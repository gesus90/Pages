import {
  Binary,
  Check,
  Copy,
  Database,
  File as FileIcon,
  FileArchive,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { downloadUrl, formatFileSize } from "./card-types";
import { CardDownloadAction } from "./content-card";
import { copyText } from "./use-card-text";
import { useRetention } from "./use-retention";

import type { LucideIcon } from "lucide-react";
import type { ConversationAttachment } from "@/definition/ConversationContent";

/**
 * The fixed columns of a file row (PAGE-385): icon, name with kind, size and
 * remaining time, checksum, download. Every row of the chat uses the same
 * widths, so rows below each other line up exactly; on a phone the checksum
 * moves to a line of its own.
 */
export const BINARY_ROW_COLUMNS =
  "grid-cols-[2rem_minmax(0,1fr)_auto] sm:grid-cols-[2rem_minmax(0,1fr)_10.5rem_8.5rem]";

/** Endings of more than one part that name one kind, such as `tar.gz`. */
const DOUBLE_ENDINGS: readonly string[] = [
  "tar.gz",
  "tar.bz2",
  "tar.xz",
  "tar.zst",
];

const ICON_ENDINGS: readonly (readonly [LucideIcon, readonly string[]])[] = [
  [
    FileArchive,
    [
      "zip",
      "7z",
      "rar",
      "gz",
      "tgz",
      "bz2",
      "xz",
      "zst",
      "tar",
      "tar.gz",
      "tar.bz2",
      "tar.xz",
      "tar.zst",
      "jar",
      "war",
    ],
  ],
  [Database, ["sqlite", "sqlite3", "db", "mdb", "accdb", "dump", "bak"]],
  [
    Binary,
    [
      "exe",
      "msi",
      "dmg",
      "pkg",
      "deb",
      "rpm",
      "apk",
      "app",
      "bin",
      "so",
      "dll",
      "dylib",
      "iso",
      "img",
      "wasm",
      "o",
    ],
  ],
  [
    FileText,
    [
      "doc",
      "xls",
      "ppt",
      "rtf",
      "docx",
      "xlsx",
      "pptx",
      "odt",
      "ods",
      "odp",
      "csv",
      "tsv",
      "pdf",
    ],
  ],
];

/** Characters of the checksum shown on each side of the ellipsis. */
const CHECKSUM_SHOWN = 8;

/**
 * The ending of a file name as its kind, such as `ZIP` or `TAR.GZ`.
 *
 * @param name - The file name.
 * @returns The ending in upper case, or an empty text without one.
 */
export function fileEndingOf(name: string): string {
  const lower = name.toLowerCase();
  const double = DOUBLE_ENDINGS.find((ending) => lower.endsWith(`.${ending}`));
  if (double) return double.toUpperCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
}

/** The icon of a file by its ending: archive, database, program, document or file. */
function iconOf(ending: string): LucideIcon {
  const lower = ending.toLowerCase();
  return (
    ICON_ENDINGS.find(([, endings]) => endings.includes(lower))?.[0] ?? FileIcon
  );
}

/**
 * The checksum as a row shows it: its start and end around an ellipsis.
 *
 * @param sha256 - The checksum in hex.
 */
export function shortChecksum(sha256: string): string {
  return `${sha256.slice(0, CHECKSUM_SHOWN)}…${sha256.slice(-CHECKSUM_SHOWN)}`;
}

/** The shortened SHA-256 with a button that copies it whole. */
function Checksum({
  sha256,
}: {
  readonly sha256: string | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isCopied, setCopied] = useState(false);
  if (sha256 === undefined)
    return (
      <span className="text-xs text-muted-foreground">
        {t("chatPage.cards.binary.noChecksum")}
      </span>
    );

  function handleCopy(): void {
    if (sha256 === undefined) return;
    copyText(sha256);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const Icon = isCopied ? Check : Copy;
  return (
    <button
      aria-label={t("chatPage.cards.binary.copyChecksum")}
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
      data-checksum={sha256}
      onClick={handleCopy}
      title={`SHA-256 ${sha256}`}
      type="button"
    >
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[10px] text-muted-foreground">SHA-256</span>
        <span className="truncate font-mono text-xs text-foreground">
          {shortChecksum(sha256)}
        </span>
      </span>
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0",
          isCopied ? "text-primary" : "text-muted-foreground",
        )}
      />
    </button>
  );
}

interface BinaryFileRowProps {
  readonly attachment: ConversationAttachment;
  /** A document above the preview limit of Pages: offered for download only, with a hint. */
  readonly isTooLarge?: boolean;
}

/**
 * The plain row of a binary file or any format the chat shows no view of
 * (PAGE-385): icon · name with kind, size and remaining time · checksum ·
 * "Herunterladen" in the accent color. No preview, no "Daneben", no full
 * screen; the file is never opened in the browser.
 */
export function BinaryFileRow({
  attachment,
  isTooLarge = false,
}: BinaryFileRowProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const retention = useRetention(attachment.expiresAt);
  const ending = fileEndingOf(attachment.name);
  const Icon = iconOf(ending);
  const meta = [
    ending || t("chatPage.cards.kind.file"),
    formatFileSize(attachment.sizeBytes, i18n.language),
    retention,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  return (
    <section
      aria-label={attachment.name}
      className={cn(
        "grid w-full max-w-2xl min-w-0 items-center gap-x-3 rounded-xl border border-border bg-surface px-3 py-2 text-foreground shadow-xs",
        BINARY_ROW_COLUMNS,
      )}
      data-binary-file={attachment.id}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <p className="flex min-w-0 flex-col leading-tight">
        <span
          className="truncate text-[13px] font-semibold"
          title={attachment.name}
        >
          {attachment.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
        {isTooLarge ? (
          <span className="truncate text-xs text-primary">
            {t("chatPage.cards.binary.tooLarge")}
          </span>
        ) : null}
      </p>
      <span className="order-last col-span-full min-w-0 pl-11 sm:order-none sm:col-span-1 sm:pl-0">
        <Checksum sha256={attachment.sha256} />
      </span>
      <span className="flex justify-end">
        <CardDownloadAction download={{ href: downloadUrl(attachment) }} />
      </span>
    </section>
  );
}
