import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import styles from "./storage-loading-bar.module.css";

/**
 * The thin bar under the menu bar of a folder that is slow to answer.
 * @remarks
 * The bar takes no room: its zero-height wrapper lets it lie over the top
 * edge of the list, so showing or hiding it moves nothing. The segment moves
 * by `transform` only. With reduced motion it stands still.
 */
export function StorageLoadingBar(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="relative z-20 h-0 shrink-0">
      <div
        aria-label={t("storage.loading")}
        className="absolute inset-x-0 top-0 h-0.5 overflow-hidden"
        role="progressbar"
      >
        <div className={cn("h-full w-[34%] bg-primary", styles.segment)} />
      </div>
    </div>
  );
}
