-- Existing projects remain departmentless; A3 introduces no seed department.
CREATE TABLE project_departments (
    project_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (project_id, department_id)
);

CREATE INDEX project_departments_by_department
    ON project_departments (department_id, project_id);
