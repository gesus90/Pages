import { TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { CodeView } from "./code-view";
import { CardAction } from "./content-card";
import { renderMermaid } from "./mermaid-render";

import type { MermaidResult } from "./mermaid-render";

const ZOOM_STEP = 0.25;
const ZOOM_MINIMUM = 0.25;
const ZOOM_MAXIMUM = 4;

/** The drawn diagram of a text, or `null` while Mermaid draws it. */
function useMermaid(source: string): MermaidResult | null {
  const [result, setResult] = useState<{
    readonly source: string;
    readonly result: MermaidResult;
  } | null>(null);

  useEffect(() => {
    let isCurrent = true;
    renderMermaid(source)
      .then((drawn) => {
        if (isCurrent) setResult({ source, result: drawn });
      })
      .catch((error: unknown) => {
        console.warn("Mermaid could not be loaded", error);
        if (isCurrent)
          setResult({
            source,
            result: { isValid: false, message: String(error) },
          });
      });
    return () => {
      isCurrent = false;
    };
  }, [source]);

  return result?.source === source ? result.result : null;
}

/** The message of a diagram with an error, above its code. */
function MermaidError({
  message,
  source,
}: {
  readonly message: string;
  readonly source: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-col">
      <div
        className="flex items-start gap-2 border-b border-border bg-destructive-subtle px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
        <p className="min-w-0">
          <span className="font-semibold">
            {t("chatPage.preview.mermaid.error")}
          </span>{" "}
          <span className="font-mono whitespace-pre-wrap">{message}</span>
        </p>
      </div>
      <CodeView languageHint="mermaid" source={source} />
    </div>
  );
}

/**
 * A Mermaid diagram drawn from the text of a block, with zoom;
 * a text with an error shows the error and the code instead.
 */
export function MermaidDiagram({
  source,
  className,
}: {
  readonly source: string;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const result = useMermaid(source);
  const [zoom, setZoom] = useState(1);
  if (result === null)
    return (
      <p className="px-3 py-3 text-sm text-muted-foreground" role="status">
        {t("chatPage.preview.mermaid.drawing")}
      </p>
    );
  if (!result.isValid)
    return <MermaidError message={result.message} source={source} />;
  return (
    <div
      className={cn("relative flex min-h-0 flex-col bg-panel-body", className)}
    >
      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-xs">
        <CardAction
          icon={ZoomOut}
          isIconOnly
          label={t("chatPage.cards.pdf.zoomOut")}
          onClick={() => setZoom(Math.max(ZOOM_MINIMUM, zoom - ZOOM_STEP))}
          variant="quiet"
        />
        <button
          className="min-w-11 text-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setZoom(1)}
          title={t("chatPage.preview.mermaid.resetZoom")}
          type="button"
        >
          {t("chatPage.cards.pdf.zoom", { percent: Math.round(zoom * 100) })}
        </button>
        <CardAction
          icon={ZoomIn}
          isIconOnly
          label={t("chatPage.cards.pdf.zoomIn")}
          onClick={() => setZoom(Math.min(ZOOM_MAXIMUM, zoom + ZOOM_STEP))}
          variant="quiet"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          aria-label={t("chatPage.preview.mermaid.diagram")}
          className="mx-auto w-fit origin-top-left [&_svg]:h-auto [&_svg]:max-w-none"
          data-mermaid-diagram=""
          // Mermaid sanitizes the diagram with its strict security level.
          dangerouslySetInnerHTML={{ __html: result.svg }}
          role="img"
          // The zoom is chosen by the person, so it is an inline style.
          style={{ zoom }}
        />
      </div>
    </div>
  );
}
