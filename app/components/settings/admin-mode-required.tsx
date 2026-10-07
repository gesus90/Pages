import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";

/** Tells an administrator in the role mode to switch modes before using the system settings. */
export function AdminModeRequired(): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();

  return (
    <SettingsCard
      className="lg:max-w-[calc(50%-0.5rem)]"
      description={t("settings.system.adminModeRequired.description")}
      icon={<Shield className="size-4" aria-hidden="true" />}
      title={t("settings.system.adminModeRequired.title")}
    >
      <Form method="post">
        <input name="intent" type="hidden" value="set-mode" />
        <input name="mode" type="hidden" value="admin" />
        <Button
          isPending={
            navigation.state === "submitting" &&
            navigation.formData?.get("intent") === "set-mode"
          }
          type="submit"
          variant="outline"
        >
          {t("users.mode.toAdmin")}
        </Button>
      </Form>
    </SettingsCard>
  );
}
