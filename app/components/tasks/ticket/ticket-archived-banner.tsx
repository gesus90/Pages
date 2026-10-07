import { Form } from "react-router";
import { useTranslation } from "react-i18next";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Button } from "@/app/components/ui/button";

interface TicketArchivedBannerProps {
  readonly ticketId: string;
  readonly isArchiving: boolean;
}

/** Renders the notice of an archived ticket with the button to restore it. */
export function TicketArchivedBanner({
  ticketId,
  isArchiving,
}: TicketArchivedBannerProps): React.ReactElement {
  const { t } = useTranslation();
  const { canWrite } = useTicketAccess();

  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-orange-50 p-3 text-xs">
      <span className="font-semibold text-foreground">
        {t("tasks.archived.banner")}
      </span>
      {canWrite ? (
        <Form method="post">
          <input name="intent" type="hidden" value="restore-task" />
          <input name="id" type="hidden" value={ticketId} />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isArchiving}
            type="submit"
            variant="ghost"
          >
            {t("tasks.archived.restore")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}
