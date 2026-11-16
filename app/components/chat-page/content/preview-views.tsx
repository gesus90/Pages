import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { CodeView } from "./code-view";
import { CsvTableView } from "./csv-table";
import { readJson } from "./json-parse";
import { JsonTree } from "./json-tree";
import { MermaidDiagram } from "./mermaid-diagram";
import { SandboxFrame } from "./sandbox-frame";
import { ViewTabs } from "./view-tabs";

import type { CardTone } from "./content-card";
import type { PreviewFile, PreviewKind } from "./preview-kinds";
import type { PreviewDevice } from "./sandbox-frame";

/** Code of an invalid JSON block with the place of its first error. */
function JsonError({
  source,
}: {
  readonly source: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const reading = readJson(source);
  const place = reading.isValid
    ? ""
    : t("chatPage.preview.json.place", {
        line: reading.line,
        column: reading.column,
      });
  return (
    <div className="flex min-h-0 flex-col">
      <p
        className="flex items-start gap-2 border-b border-border bg-warning-subtle px-3 py-2 text-xs text-foreground"
        role="alert"
      >
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-warning"
        />
        <span>
          <span className="font-semibold">
            {t("chatPage.preview.json.invalid")}
          </span>
          {place === "" ? null : ` ${place}`}
          {reading.isValid ? null : (
            <span className="block font-mono text-muted-foreground">
              {reading.message}
            </span>
          )}
        </span>
      </p>
      <CodeView languageHint="json" source={source} />
    </div>
  );
}

function JsonView({
  source,
  className,
}: {
  readonly source: string;
  readonly className?: string;
}): React.ReactElement {
  const reading = readJson(source);
  if (!reading.isValid) return <JsonError source={source} />;
  return <JsonTree className={className} value={reading.value} />;
}

/** What a preview shows: its kind, files and how it is framed. */
export interface PreviewViewProps {
  readonly kind: PreviewKind;
  readonly files: readonly PreviewFile[];
  /** The accessible name of a sandbox frame. */
  readonly title: string;
  /** Changes with "Neu laden". */
  readonly reloadKey: number;
  readonly device?: PreviewDevice;
  readonly tone?: CardTone;
  readonly className?: string;
}

/**
 * The preview of a block: HTML and SVG in the sandbox, Mermaid as
 * a diagram, JSON as a tree and CSV or TSV as a table.
 */
export function PreviewView({
  kind,
  files,
  title,
  reloadKey,
  device,
  tone,
  className,
}: PreviewViewProps): React.ReactElement {
  const source = files[0]?.source ?? "";
  switch (kind) {
    case "html":
    case "svg":
      return (
        <SandboxFrame
          className={className}
          device={device}
          files={files}
          reloadKey={reloadKey}
          title={title}
          tone={tone}
        />
      );
    case "mermaid":
      return <MermaidDiagram className={className} source={source} />;
    case "json":
      return <JsonView className={className} source={source} />;
    case "csv":
    case "tsv":
      return (
        <CsvTableView
          className={className}
          languageHint={kind}
          source={source}
        />
      );
  }
}

/**
 * The code of a preview: one file, or the files of an HTML block
 * with its CSS and JavaScript blocks behind file tabs.
 */
export function PreviewCode({
  files,
  selected,
  onSelect,
  tone = "light",
  className,
}: {
  readonly files: readonly PreviewFile[];
  /** The name of the shown file; the first file when it is missing. */
  readonly selected?: string;
  readonly onSelect?: (name: string) => void;
  readonly tone?: CardTone;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [ownSelection, setOwnSelection] = useState(files[0]?.name ?? "");
  const name = selected ?? ownSelection;
  const file = files.find((entry) => entry.name === name) ?? files[0];

  function handleSelect(next: string): void {
    setOwnSelection(next);
    onSelect?.(next);
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {files.length > 1 ? (
        <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
          <ViewTabs
            label={t("chatPage.preview.files")}
            onChange={handleSelect}
            options={files.map((entry) => ({
              value: entry.name,
              label: entry.name,
            }))}
            tone={tone}
            value={file?.name ?? ""}
          />
        </div>
      ) : null}
      <CodeView
        className="min-h-0 flex-1"
        languageHint={file?.languageHint ?? ""}
        source={file?.source ?? ""}
      />
    </div>
  );
}
