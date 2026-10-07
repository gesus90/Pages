import { Settings, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { WHITE_SCROLL_FADE_STYLE } from "@/app/lib/scroll-fade-style";

import styles from "./project-integrations-tab.module.css";

interface PanelShellProps {
  readonly serviceName: string;
  readonly onClose: () => void;
  readonly footer: React.ReactNode;
  /** Outcome of the last action; it stays in view while the content scrolls. */
  readonly notice?: React.ReactNode;
  readonly children: React.ReactNode;
}

/**
 * Renders the independent overlay panel chrome with sticky header and footer.
 *
 * @remarks
 * The panel is `position: fixed` and floats above the page, so opening it
 * never changes the width or position of the main content behind it.
 */
export function PanelShell({
  serviceName,
  onClose,
  footer,
  notice = null,
  children,
}: PanelShellProps): React.ReactElement {
  const { t } = useTranslation();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      aria-label={t("projectDetail.interfaces.settingsTitle")}
      className={styles.overlay}
      role="dialog"
      aria-modal="false"
    >
      <div className={styles.panel}>
        <header className="shrink-0 border-b px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-foreground">
              <Settings
                className="size-5 shrink-0 text-foreground"
                aria-hidden="true"
              />
              <span className="truncate">
                {t("projectDetail.interfaces.settingsTitle")}
              </span>
            </p>
            <button
              aria-label={t("projectDetail.interfaces.closePanel")}
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("projectDetail.interfaces.settingsSubtitle", {
              name: serviceName,
            })}
          </p>
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col"
          style={WHITE_SCROLL_FADE_STYLE}
        >
          <VerticalScrollArea
            className="min-h-0 flex-1"
            contentClassName="gap-5 px-6 py-5"
            viewportClassName="pr-1"
          >
            {children}
          </VerticalScrollArea>
        </div>

        {notice ? (
          <div className="shrink-0 border-t bg-surface px-6 pt-3">{notice}</div>
        ) : null}

        <footer
          className={cn(
            "flex shrink-0 items-center justify-end gap-2 bg-surface px-6 py-4",
            !notice && "border-t",
          )}
        >
          {footer}
        </footer>
      </div>
    </div>
  );
}
