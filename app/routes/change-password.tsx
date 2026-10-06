import { useTranslation } from "react-i18next";
import { redirect, useActionData, useNavigation } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { RequiredPasswordForm } from "@/app/components/auth/required-password-form";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleChangePassword } from "@/app/lib/settings-actions/settings-account-actions.server";

import type { User } from "@/definition/User";
import type { Route } from "./+types/change-password";

async function requirePasswordChange(request: Request): Promise<User> {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/login");
  }

  if (!user.mustChangePassword) {
    throw redirect("/dashboard");
  }

  return user;
}

/** Allows only authenticated accounts whose password must be replaced. */
export async function loader({ request }: Route.LoaderArgs): Promise<null> {
  await requirePasswordChange(request);
  return null;
}

/** Replaces the temporary password before any workspace request is allowed. */
export async function action({
  request,
}: Route.ActionArgs): Promise<
  Response | Awaited<ReturnType<typeof handleChangePassword>>
> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = await requirePasswordChange(request);
  const result = await handleChangePassword({
    formData: await request.formData(),
    request,
    services: await getApplicationServices(),
    user,
  });

  return result.data.outcome === "success" ? redirect("/dashboard") : result;
}

/** Shows the mandatory password replacement without workspace navigation. */
export default function ChangePasswordRoute(): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionData<typeof action>()?.outcome;
  const navigation = useNavigation();

  return (
    <AuthLayout>
      <AuthHeading
        title={t("settings.security.password.dialogTitle")}
        subtitle={t("settings.security.password.requiredChange")}
      />
      <RequiredPasswordForm
        outcome={outcome}
        isSubmitting={navigation.state === "submitting"}
      />
    </AuthLayout>
  );
}
