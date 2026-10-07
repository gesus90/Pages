import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";
import { UserDirectory } from "@/app/components/users/user-directory";
import { RoleCatalog } from "@/app/components/users/role-catalog";
import { GroupCatalog } from "@/app/components/users/group-catalog";
import { DepartmentCatalog } from "@/app/components/users/department-catalog";
import { ManagementFeedback } from "@/app/components/users/management-feedback";

import type { AdministrationPageData } from "@/definition/Authorization";

/** The management sections share the page layout and accessible tab pattern. */
export function ManagementWorkspace({
  directory,
}: {
  readonly directory: AdministrationPageData;
}): React.ReactElement {
  const { t } = useTranslation();
  const [section, setSection] = useState("users");
  const tabs = [{ value: "users", label: t("users.sections.users") }];
  if (directory.canManageRoles)
    tabs.push({ value: "roles", label: t("users.sections.roles") });
  if (directory.canManageDepartments)
    tabs.push({ value: "departments", label: t("users.sections.departments") });
  if (directory.groups.canManage)
    tabs.push({ value: "groups", label: t("users.sections.groups") });
  const current = tabs.some((tab) => tab.value === section) ? section : "users";
  return (
    <section className="pages-page-fill mx-auto flex w-full max-w-6xl flex-col">
      <ManagementFeedback />
      <header className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("users.title")}
        </h1>
      </header>
      <Tabs
        value={current}
        onValueChange={setSection}
        tabs={tabs}
        ariaLabel={t("users.title")}
        className="mt-6 flex-1"
      >
        <TabsContent
          value="users"
          className="mt-6 flex min-h-0 flex-1 flex-col"
        >
          <UserDirectory directory={directory} />
        </TabsContent>
        {directory.canManageRoles ? (
          <TabsContent value="roles" className="mt-6 min-h-0 flex-1">
            <RoleCatalog directory={directory} />
          </TabsContent>
        ) : null}
        {directory.canManageDepartments ? (
          <TabsContent value="departments" className="mt-6 min-h-0 flex-1">
            <DepartmentCatalog directory={directory} />
          </TabsContent>
        ) : null}
        {directory.groups.canManage ? (
          <TabsContent value="groups" className="mt-6 min-h-0 flex-1">
            <GroupCatalog directory={directory} />
          </TabsContent>
        ) : null}
      </Tabs>
    </section>
  );
}
