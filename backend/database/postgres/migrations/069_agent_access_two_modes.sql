-- Agents, plan nodes and swarms run in exactly two modes: "Lesend"
-- (read_only) and "YOLO" (yolo). YOLO now runs natively on the host with the
-- rights of the executing Linux account; a stored yolo takes this meaning.
--
-- An explicitly stored "full_environment" of a plan node or an agent profile
-- becomes "yolo". Plans and profiles store their run options as JSON written
-- by JSON.stringify, so the explicit value appears exactly in this form.
--
-- "workspace" (agent employees) and "workspace_write" (plan nodes, swarms)
-- stay as they are: they are readable earlier values that never run and
-- never become YOLO on their own; a person chooses one of the two modes.
--
-- Run records, journals and session records are history and keep the rights
-- they were recorded with.

UPDATE agent_plans
SET plan_json = replace(
    plan_json,
    '"access":"full_environment"',
    '"access":"yolo"'
)
WHERE plan_json LIKE '%"access":"full_environment"%';

UPDATE agent_execution_profiles
SET configuration_json = replace(
    configuration_json,
    '"access":"full_environment"',
    '"access":"yolo"'
)
WHERE configuration_json LIKE '%"access":"full_environment"%';
