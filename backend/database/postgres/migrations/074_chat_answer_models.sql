-- The model an agent answered with, kept with its stored answer: catalog name,
-- provider, model ID, reasoning level and whether the catalog of the
-- connection the run used stated the model free. The chat shows it in the
-- head of the answer after a reload. The JSON is written by Pages only;
-- answers stored before stay NULL and show no price badge.
ALTER TABLE conversation_messages
    ADD COLUMN answer_model TEXT;

ALTER TABLE chat_messages
    ADD COLUMN answer_model TEXT;
