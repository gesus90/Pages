import { RunDiagnosisPage } from "@/app/components/agents/runs/run-diagnosis-page";

/** The view "Runs" of the plan area; the data comes from the rights-checked run diagnosis endpoint. */
export default function AgentRunsRoute(): React.ReactElement {
  return <RunDiagnosisPage />;
}
