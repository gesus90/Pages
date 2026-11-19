ALTER TABLE agent_connections
    ADD COLUMN openrouter_credit_start_amount DOUBLE PRECISION,
    ADD COLUMN openrouter_credit_start_usage DOUBLE PRECISION,
    ADD CONSTRAINT agent_connections_openrouter_credit_balance
    CHECK (
        (
            openrouter_credit_start_amount IS NULL
            AND openrouter_credit_start_usage IS NULL
        )
        OR (
            provider = 'openrouter'
            AND openrouter_credit_start_amount IS NOT NULL
            AND openrouter_credit_start_amount >= 0
            AND openrouter_credit_start_amount < 'Infinity'::DOUBLE PRECISION
            AND (
                openrouter_credit_start_usage IS NULL
                OR (
                    openrouter_management_secret_encrypted IS NOT NULL
                    AND openrouter_credit_start_usage >= 0
                    AND openrouter_credit_start_usage < 'Infinity'::DOUBLE PRECISION
                )
            )
        )
    );
