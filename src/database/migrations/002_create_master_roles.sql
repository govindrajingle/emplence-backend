-- 002: available application roles.
-- Managed through backend code only; there is no public role-creation API.
CREATE TABLE master_roles (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  role_name     VARCHAR(100) NOT NULL,
  role_code     VARCHAR(50)  NOT NULL,
  is_valid      BOOLEAN      NOT NULL DEFAULT TRUE,
  dt_entry_date TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT pk_master_roles PRIMARY KEY (id),
  CONSTRAINT uq_master_roles_role_code UNIQUE (role_code),
  CONSTRAINT chk_master_roles_role_name_not_blank CHECK (btrim(role_name) <> ''),
  CONSTRAINT chk_master_roles_role_code_not_blank CHECK (btrim(role_code) <> '')
);

COMMENT ON TABLE master_roles IS 'User roles referenced by users.role_id.';
COMMENT ON COLUMN master_roles.role_code IS 'Unique, stable role identifier (ADMIN, EMPLOYEE).';
