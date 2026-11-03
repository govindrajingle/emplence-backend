-- 005: initial master roles.
-- ON CONFLICT keeps this idempotent: re-running the migration or the app's
-- startup seeding never creates duplicate roles.
INSERT INTO master_roles (role_name, role_code)
VALUES
  ('Administrator', 'ADMIN'),
  ('Employee', 'EMPLOYEE')
ON CONFLICT (role_code) DO NOTHING;
