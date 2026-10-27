import { useTranslation } from "react-i18next";

import type { PlanRemoteFile } from "@/definition/AgentPlanRemoteAccess";

/** Distinguishes source/model content from the unchanged original download. */
export function PlanAssetEntry({
  file,
}: {
  readonly file: PlanRemoteFile;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="min-w-0 wrap-anywhere">
      {file.outcome === "staged" ? (
        <span className="block text-muted-foreground">
          {t("plans.remoteAccess.staged")}
        </span>
      ) : null}
      {file.outcome === "uploaded" ? (
        <span className="block font-semibold">
          {t("plans.remoteAccess.uploaded")}
        </span>
      ) : null}
      {file.parameter} · {file.name} · {file.type} ·{" "}
      {t("plans.remoteAccess.bytes", { count: file.size })}
      <span className="block text-muted-foreground">
        {t(`plans.remoteAccess.${file.representation ?? "original"}`)}
      </span>
      {file.modelContent ? (
        <span className="block text-muted-foreground">
          {t("plans.remoteAccess.file-only", { reason: file.modelContent })}
        </span>
      ) : null}
      {file.isTruncated ? (
        <span className="block text-muted-foreground">
          {t("plans.remoteAccess.truncated")}
        </span>
      ) : null}
      {file.asset ? (
        <a className="text-primary underline" href={file.asset.link} download>
          {t("plans.remoteAccess.original")}
        </a>
      ) : null}
    </li>
  );
}
