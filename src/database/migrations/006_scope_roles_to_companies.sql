-- 006: company-scoped roles with a hierarchy.
--
-- company_id NULL      -> global/system role (ADMIN, EMPLOYEE), usable by every company
-- company_id NOT NULL  -> role owned by that company (created by its sub-admin)
--
-- hierarchy_level: lower number = more authority. ADMIN=1, EMPLOYEE=100 by default.
-- A sub-admin may only create/assign roles with a level greater than their own.
ALTER TABLE master_roles
  ADD COLUMN company_id      BIGINT,
  ADD COLUMN hierarchy_level INTEGER NOT NULL DEFAULT 100;

ALTER TABLE master_roles
  ADD CONSTRAINT fk_master_roles_company
    FOREIGN KEY (company_id) REFERENCES master_companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT chk_master_roles_hierarchy_level CHECK (hierarchy_level > 0);

-- Role codes are unique per company; global roles (company_id IS NULL) stay unique
-- among themselves thanks to NULLS NOT DISTINCT.
ALTER TABLE master_roles DROP CONSTRAINT uq_master_roles_role_code;
ALTER TABLE master_roles
  ADD CONSTRAINT uq_master_roles_company_code UNIQUE NULLS NOT DISTINCT (company_id, role_code);

CREATE INDEX idx_master_roles_company_id ON master_roles (company_id);

-- Existing seeded roles keep their meaning: ADMIN is top of the hierarchy.
UPDATE master_roles SET hierarchy_level = 1 WHERE role_code = 'ADMIN' AND company_id IS NULL;
UPDATE master_roles SET hierarchy_level = 100 WHERE role_code = 'EMPLOYEE' AND company_id IS NULL;

COMMENT ON COLUMN master_roles.company_id IS 'NULL = global role available to all companies; otherwise the owning company.';
COMMENT ON COLUMN master_roles.hierarchy_level IS 'Authority level; lower value = higher authority. A manager can only grant higher numbers than their own.';
