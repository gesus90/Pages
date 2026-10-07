import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";

/** Asks for confirmation before every other session of the user is signed out. */
export function RevokeOtherSessionsDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const response = useActionOutcome("revoke-other-sessions");
  const lastHandledResponse = useRef<typeof response>(null);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "revoke-other-sessions";

  useEffect(() => {
    if (!open || response === lastHandledResponse.current) {
      return;
    }

    lastHandledResponse.current = response;
    onOpenChange(false);
  }, [open, response, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t("settings.security.sessions.endOthersTitle")}
        </DialogTitle>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("settings.security.sessions.endOthersText")}
        </p>

        <Form className="mt-5 flex justify-end gap-2" method="post">
          <input name="intent" type="hidden" value="revoke-other-sessions" />
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("settings.security.sessions.cancel")}
            </Button>
          </DialogClose>
          <Button
            className="border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isSubmitting}
            type="submit"
            variant="outline"
          >
            {isSubmitting
              ? t("settings.security.sessions.revoking")
              : t("settings.security.sessions.endOthersConfirm")}
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
