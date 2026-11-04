-- 007: company-based hierarchical authorization with explicit permissions.
--
-- Safe & idempotent:
--   * no DROP / TRUNCATE
--   * existing roles and users are preserved (only known global codes are normalised)
--   * users.created_by_user_id is nullable, so historical rows stay valid
--   * role_permissions creation/granting can run repeatedly

-- 1. Audit trail: which user created another user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_created_by') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users (id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_created_by_user_id ON users (created_by_user_id);

-- 2. Normalise the known global roles to the agreed hierarchy.
--    Unknown/custom roles are intentionally left untouched (see DATABASE_DESIGN.md §D).
UPDATE master_roles SET hierarchy_level = 100
 WHERE company_id IS NULL AND role_code = 'ADMIN'    AND hierarchy_level <> 100;
UPDATE master_roles SET hierarchy_level = 200
 WHERE company_id IS NULL AND role_code = 'OWNER'    AND hierarchy_level <> 200;
UPDATE master_roles SET hierarchy_level = 250
 WHERE company_id IS NULL AND role_code = 'MANAGER'  AND hierarchy_level <> 250;
UPDATE master_roles SET hierarchy_level = 300
 WHERE company_id IS NULL AND role_code = 'EMPLOYEE' AND hierarchy_level <> 300;

-- 3. Seed the missing role templates (global templates; a company may also own
--    its own variant of the same code thanks to uq_master_roles_company_code).
INSERT INTO master_roles (role_name, role_code, company_id, hierarchy_level)
VALUES
  ('Administrator',  'ADMIN',          NULL, 100),
  ('Owner',          'OWNER',          NULL, 200),
  ('Manager',        'MANAGER',        NULL, 250),
  ('Employee',       'EMPLOYEE',       NULL, 300),
  ('Cleaner',        'CLEANER',        NULL, 300),
  ('Driver',         'DRIVER',         NULL, 300),
  ('Office Boy',     'OFFICE_BOY',     NULL, 300),
  ('Security Guard', 'SECURITY_GUARD', NULL, 300),
  ('Receptionist',   'RECEPTIONIST',   NULL, 300)
ON CONFLICT (company_id, role_code) DO NOTHING;

-- 4. Permission catalogue per role (role_id + permission_code is unique).
CREATE TABLE IF NOT EXISTS role_permissions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  role_id         BIGINT       NOT NULL,
  permission_code VARCHAR(100) NOT NULL,
  is_valid        BOOLEAN      NOT NULL DEFAULT TRUE,
  dt_entry_date   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT pk_role_permissions PRIMARY KEY (id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES master_roles (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT uq_role_permissions_role_code UNIQUE (role_id, permission_code),
  CONSTRAINT chk_role_permissions_code_not_blank CHECK (btrim(permission_code) <> '')
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_code ON role_permissions (permission_code);

-- 5. Grant the management permissions to every role that outranks employee level
--    (ADMIN 100, OWNER 200, MANAGER 250 and any custom role below 300).
--    Employee-level roles (>= 300) intentionally receive no permissions.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
  FROM master_roles r
 CROSS JOIN (VALUES ('USER_CREATE'), ('USER_VIEW'), ('USER_UPDATE'), ('USER_DELETE'))
       AS p(permission_code)
 WHERE r.is_valid = TRUE
   AND r.hierarchy_level < 300
ON CONFLICT (role_id, permission_code) DO NOTHING;

COMMENT ON COLUMN users.created_by_user_id IS 'User who created this account (NULL for historical/bootstrap rows).';
COMMENT ON TABLE role_permissions IS 'Permission grants per role; hierarchy authority is evaluated separately.';
