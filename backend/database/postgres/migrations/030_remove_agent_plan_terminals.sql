-- PAGE-284: every local plan node runs over ACP and its dialog shows the
-- stored ACP session history in the Pages terminal. The PTY terminals of
-- PAGE-265 are gone, and their stored output and inputs with them. Step
-- reports, acceptance and run status of older runs stay in their own tables;
-- agent_plan_runs.manual_input_at stays as the mark of manual input.
DROP TABLE IF EXISTS agent_plan_terminal_inputs;

DROP TABLE IF EXISTS agent_plan_terminal_segments;

DROP TABLE IF EXISTS agent_plan_terminals;
