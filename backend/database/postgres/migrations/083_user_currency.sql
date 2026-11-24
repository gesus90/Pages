-- The currency a user chose for showing costs, such as the session costs in
-- the agent plan terminal. NULL keeps the US dollar display of accounts that
-- never chose one. The choice changes only the display; the amount a provider
-- reports or Pages estimates keeps its own currency.
ALTER TABLE user_settings
    ADD COLUMN currency TEXT CHECK (currency IN ('EUR', 'USD'));
