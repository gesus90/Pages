/** A checklist or step fraction; an empty or unknown list has no completed arc. */
export function PlanStatusDonut({
  completed,
  total,
  tone = "steps",
}: {
  readonly completed: number;
  readonly total: number;
  readonly tone?: "steps" | "todos";
}): React.ReactElement {
  const fraction = total > 0 ? Math.min(completed / total, 1) : 0;
  return (
    <svg
      viewBox="0 0 56 56"
      aria-hidden="true"
      className="size-6 shrink-0 -rotate-90"
    >
      <circle
        cx="28"
        cy="28"
        r="24"
        fill="none"
        stroke="var(--color-plan-progress-waiting)"
        strokeWidth="7"
      />
      {fraction > 0 ? (
        <circle
          cx="28"
          cy="28"
          r="24"
          fill="none"
          stroke={
            tone === "todos"
              ? "var(--color-status-active)"
              : "var(--color-plan-progress-done)"
          }
          strokeWidth="7"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${fraction * 100} 100`}
        />
      ) : null}
    </svg>
  );
}
