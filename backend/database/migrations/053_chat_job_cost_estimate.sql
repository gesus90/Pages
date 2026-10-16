-- Whether the cost of a Pica job is the adapter's own estimate (PAGE-90).
-- Claude Code computes its cost from token counts and list prices; for a
-- subscription sign-in none of it is billed. NULL where no cost was reported.
ALTER TABLE chat_jobs ADD COLUMN cost_is_estimated BOOLEAN;
