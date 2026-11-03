-- 001: master list of registered companies.
-- Parent table for companies_locations and users.
CREATE TABLE master_companies (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  company_name  VARCHAR(255) NOT NULL,
  company_code  VARCHAR(50)  NOT NULL,
  is_valid      BOOLEAN      NOT NULL DEFAULT TRUE,
  dt_entry_date TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT pk_master_companies PRIMARY KEY (id),
  CONSTRAINT uq_master_companies_company_code UNIQUE (company_code),
  CONSTRAINT chk_master_companies_company_name_not_blank CHECK (btrim(company_name) <> ''),
  CONSTRAINT chk_master_companies_company_code_not_blank CHECK (btrim(company_code) <> '')
);

COMMENT ON TABLE master_companies IS 'Master information of registered companies.';
COMMENT ON COLUMN master_companies.company_code IS 'Unique company identification code.';
COMMENT ON COLUMN master_companies.is_valid IS 'FALSE marks the record as inactive without deleting it.';
