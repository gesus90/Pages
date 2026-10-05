import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { PAGE_SIZE_KEYS } from "@/app/lib/team-members";

import type { PageSizeKey, TeamPage } from "@/app/lib/team-members";

interface TeamPaginationProps {
  readonly memberCount: number;
  readonly matchCount: number;
  readonly page: TeamPage;
  readonly pageSize: PageSizeKey;
  readonly onPageSizeChange: (pageSize: PageSizeKey) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

/** Renders the member count, page size, range and paging buttons. */
export function TeamPagination({
  memberCount,
  matchCount,
  page,
  pageSize,
  onPageSizeChange,
  onPrevious,
  onNext,
}: TeamPaginationProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{memberCount}</span>{" "}
        {memberCount === 1
          ? t("projectDetail.team.member")
          : t("projectDetail.team.members")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {t("projectDetail.team.pageSize")}
        </span>
        <Select
          ariaLabel={t("projectDetail.team.pageSize")}
          value={pageSize}
          onValueChange={onPageSizeChange}
          className="min-w-20"
          options={PAGE_SIZE_KEYS.map((option) => ({
            value: option,
            label: option,
          }))}
        />
        <span className="text-sm text-muted-foreground">
          {t("projectDetail.team.rangeOfTotal", {
            from: page.rangeStart,
            to: page.rangeEnd,
            total: matchCount,
          })}
        </span>
        <span className="flex gap-1">
          <Button
            className="size-9 min-h-0 px-0"
            variant="ghost"
            aria-label={t("projectDetail.team.previousPage")}
            disabled={page.currentPage === 0}
            onClick={onPrevious}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            className="size-9 min-h-0 px-0"
            variant="ghost"
            aria-label={t("projectDetail.team.nextPage")}
            disabled={page.currentPage >= page.pageCount - 1}
            onClick={onNext}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </div>
    </div>
  );
}
