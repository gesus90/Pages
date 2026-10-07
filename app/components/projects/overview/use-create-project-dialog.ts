import { useEffect, useState } from "react";
import { useActionData, useNavigate, useNavigation } from "react-router";

import { PROJECT_STATUS } from "@/definition/Project";

import type {
  ProjectActionError,
  ProjectActionResult,
} from "@/app/lib/project-overview-actions.server";
import type { ProjectStatus } from "@/definition/Project";

/** The open state, the chosen status and the outcome of the create dialog. */
export interface CreateProjectDialogState {
  readonly selectedTemplateId: string;
  readonly setSelectedTemplateId: (templateId: string) => void;
  readonly isOpen: boolean;
  readonly setIsOpen: (isOpen: boolean) => void;
  readonly selectedStatus: ProjectStatus;
  readonly setSelectedStatus: (status: ProjectStatus) => void;
  readonly selectedDepartments: readonly string[];
  readonly setSelectedDepartments: (departmentIds: string[]) => void;
  readonly isSubmitting: boolean;
  /** Why the last submission failed, or `null` when it did not. */
  readonly error: ProjectActionError | null;
}

/**
 * Keeps the state of the dialog that creates a project.
 *
 * @remarks
 * A created project closes the dialog, resets the status and opens the
 * project page.
 */
export function useCreateProjectDialog(): CreateProjectDialogState {
  const actionData = useActionData<ProjectActionResult | undefined>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<ProjectStatus>(
    PROJECT_STATUS.PLANNED,
  );
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "create-project";
  const error =
    actionData?.intent === "create-project" && !actionData.ok
      ? actionData.error
      : null;

  useEffect(() => {
    if (actionData?.intent === "create-project" && actionData.ok) {
      setIsOpen(false);
      setSelectedStatus(PROJECT_STATUS.PLANNED);
      setSelectedDepartments([]);
      setSelectedTemplateId("");
      void navigate(
        actionData.canOpen === false
          ? "/projekte"
          : `/projekte/${encodeURIComponent(actionData.projectId)}`,
      );
    }
  }, [actionData, navigate]);

  return {
    selectedTemplateId,
    setSelectedTemplateId,
    error,
    isOpen,
    isSubmitting,
    selectedStatus,
    setIsOpen,
    setSelectedStatus,
    selectedDepartments,
    setSelectedDepartments,
  };
}
