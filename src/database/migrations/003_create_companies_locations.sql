-- 003: branches/offices/premises belonging to a company (one-to-many).
CREATE TABLE companies_locations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  company_id    BIGINT       NOT NULL,
  location_name VARCHAR(255) NOT NULL,
  location_code VARCHAR(50)  NOT NULL,
  is_valid      BOOLEAN      NOT NULL DEFAULT TRUE,
  dt_entry_date TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT pk_companies_locations PRIMARY KEY (id),
  CONSTRAINT fk_companies_locations_company
    FOREIGN KEY (company_id) REFERENCES master_companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT uq_companies_locations_company_code UNIQUE (company_id, location_code),
  CONSTRAINT chk_companies_locations_location_name_not_blank CHECK (btrim(location_name) <> ''),
  CONSTRAINT chk_companies_locations_location_code_not_blank CHECK (btrim(location_code) <> '')
);

-- Supports lookups of all locations of a company.
CREATE INDEX idx_companies_locations_company_id ON companies_locations (company_id);

COMMENT ON TABLE companies_locations IS 'Branches, offices and premises of a company.';
COMMENT ON COLUMN companies_locations.location_code IS 'Unique within its company (company_id, location_code).';
