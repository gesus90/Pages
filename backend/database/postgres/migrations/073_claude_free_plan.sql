-- The usage query of Claude Code may name the free claude.ai plan. A card
-- shows "Free" only for that explicit value, so the stored plan accepts it
-- beside pro, max and ultra; NULL stays a sign-in without a known plan.
ALTER TABLE claude_connection_plans
    DROP CONSTRAINT IF EXISTS claude_connection_plans_plan_check;

ALTER TABLE claude_connection_plans
    ADD CONSTRAINT claude_connection_plans_plan_check
    CHECK (plan IN ('free', 'pro', 'max', 'ultra'));
