-- 004: application users (basic credentials first, profile fields later).
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  username      VARCHAR(100) NOT NULL,
  password      VARCHAR(255) NOT NULL,
  role_id       BIGINT       NOT NULL,
  company_id    BIGINT,
  location_id   BIGINT,
  is_valid      BOOLEAN      NOT NULL DEFAULT TRUE,
  dt_entry_date TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES master_roles (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_users_company
    FOREIGN KEY (company_id) REFERENCES master_companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_users_location
    FOREIGN KEY (location_id) REFERENCES companies_locations (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_users_username_not_blank CHECK (btrim(username) <> ''),
  CONSTRAINT chk_users_password_not_blank CHECK (btrim(password) <> ''),
  -- A location cannot be assigned without its company; the model layer also verifies
  -- that the location actually belongs to that company before writing.
  CONSTRAINT chk_users_location_requires_company CHECK (location_id IS NULL OR company_id IS NOT NULL)
);

-- Usernames are compared case-insensitively by the application (login lookups).
CREATE UNIQUE INDEX uq_users_username_lower ON users (lower(username));

-- Foreign key lookup indexes.
CREATE INDEX idx_users_role_id ON users (role_id);
CREATE INDEX idx_users_company_id ON users (company_id);
CREATE INDEX idx_users_location_id ON users (location_id);

COMMENT ON TABLE users IS 'Application users with hashed credentials and organizational assignment.';
COMMENT ON COLUMN users.password IS 'bcrypt hash (never plain text).';
COMMENT ON COLUMN users.role_id IS 'Role assigned by backend logic; public registration always uses EMPLOYEE.';
