-- Milestones and initiatives are linked many to many (A11.5, T6.13.1). A
-- ticket still carries exactly one milestone in work_items.milestone_id; an
-- initiative can in addition span several milestones through this table. The
-- hierarchy itself stays in work_items.type and work_items.parent_id.
CREATE TABLE milestone_initiatives (
    milestone_id TEXT NOT NULL,
    initiative_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (milestone_id, initiative_id)
);

CREATE INDEX milestone_initiatives_initiative_id
    ON milestone_initiatives (initiative_id);
