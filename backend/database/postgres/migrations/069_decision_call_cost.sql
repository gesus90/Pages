-- What the call of the decision model cost in US dollars, as OpenRouter
-- states it in `usage.cost`; NULL when the model was not asked or stated no
-- cost.
ALTER TABLE conversation_reply_decisions
    ADD COLUMN cost_usd DOUBLE PRECISION;
