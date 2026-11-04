'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

require('../src/config/env');

process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = require('../src/app');
const { closePool, getPool } = require('../src/config/db');
const roleModel = require('../src/models/roleModel');
const rolePermissionModel = require('../src/models/rolePermissionModel');
const userModel = require('../src/models/userModel');
const companyModel = require('../src/models/companyModel');

const BCRYPT_PASSWORD = 'secret123';
const suffix = Date.now().toString(36);

let server;
let baseUrl;

const state = {
  companyA: null,
  companyB: null,
  users: {},
  customRoleIds: [],
  companyIds: [],
  roleIds: [],
};

const request = async (method, path, { token, adminKey, body } = {}) => {
  const headers = { 'content-type': 'application/json' };

  if (token) headers.authorization = `Bearer ${token}`;
  if (adminKey) headers['x-admin-key'] = adminKey;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }

  return { status: response.status, json, text };
};

const login = async (username) => {
  const response = await request('POST', '/api/auth/login', {
    body: { username, password: BCRYPT_PASSWORD },
  });

  return response.json?.data?.token;
};

const roleIdFor = async (code, companyId = null) => {
  const role = await roleModel.findByCode(code, { companyId });

  assert.ok(role, `expected role ${code} to exist`);
  return role.id;
};

const createUser = async (username, roleId, companyId, createdByUserId = null) =>
  userModel.create({
    username,
    password: BCRYPT_PASSWORD,
    roleId,
    companyId,
    createdByUserId,
  });

before(async () => {
  // Fail fast with a clear message if the database is not reachable/migrated.
  const ping = await getPool().query(
    `SELECT to_regclass('public.role_permissions') AS permissions_table,
            to_regclass('public.users') AS users_table`,
  );

  assert.ok(ping.rows[0].users_table, 'users table missing - run `npm run db:migrate`');
  assert.ok(
    ping.rows[0].permissions_table,
    'role_permissions table missing - run `npm run db:migrate`',
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  state.companyA = await companyModel.create({
    companyName: `Authz Alpha ${suffix}`,
    companyCode: `AZA${suffix}`.toUpperCase(),
  });
  state.companyB = await companyModel.create({
    companyName: `Authz Beta ${suffix}`,
    companyCode: `AZB${suffix}`.toUpperCase(),
  });
  state.companyIds.push(state.companyA.id, state.companyB.id);

  const roleIds = {
    admin: await roleIdFor('ADMIN'),
    owner: await roleIdFor('OWNER'),
    manager: await roleIdFor('MANAGER'),
    employee: await roleIdFor('EMPLOYEE'),
    cleaner: await roleIdFor('CLEANER'),
    driver: await roleIdFor('DRIVER'),
  };

  state.users.admin = await createUser(`admin_${suffix}`, roleIds.admin, null);
  state.users.ownerA = await createUser(`ownerA_${suffix}`, roleIds.owner, state.companyA.id, state.users.admin.id);
  state.users.managerA = await createUser(`managerA_${suffix}`, roleIds.manager, state.companyA.id, state.users.ownerA.id);
  state.users.employeeA = await createUser(`employeeA_${suffix}`, roleIds.cleaner, state.companyA.id, state.users.managerA.id);
  state.users.ownerB = await createUser(`ownerB_${suffix}`, roleIds.owner, state.companyB.id, state.users.admin.id);
  state.users.employeeB = await createUser(`employeeB_${suffix}`, roleIds.employee, state.companyB.id, state.users.ownerB.id);
  state.users.inactiveA = await createUser(`inactiveA_${suffix}`, roleIds.manager, state.companyA.id);

  // Role with a revoked permission set: only USER_VIEW (no create/update/delete).
  const limitedRole = await roleModel.create({
    roleName: 'Limited Manager',
    roleCode: `LIMITED_${suffix}`.toUpperCase(),
    companyId: state.companyA.id,
    hierarchyLevel: 250,
  });
  await rolePermissionModel.setForRole(limitedRole.id, ['USER_VIEW']);
  state.users.limitedA = await createUser(`limitedA_${suffix}`, limitedRole.id, state.companyA.id);
  state.customRoleIds.push(limitedRole.id);

  // Role that gets deactivated after its user logged in.
  const frozenRole = await roleModel.create({
    roleName: 'Frozen Manager',
    roleCode: `FROZEN_${suffix}`.toUpperCase(),
    companyId: state.companyA.id,
    hierarchyLevel: 250,
  });
  state.users.frozenA = await createUser(`frozenA_${suffix}`, frozenRole.id, state.companyA.id);
  state.customRoleIds.push(frozenRole.id);

  state.users.frozenA.token = await login(state.users.frozenA.username);
  await roleModel.update(frozenRole.id, { isValid: false });

  state.users.inactiveA.token = await login(state.users.inactiveA.username);
  await userModel.update(state.users.inactiveA.id, { isValid: false });

  // Guarantee the seeded permission baseline, even after an aborted earlier run.
  await rolePermissionModel.setForRole(roleIds.employee, []);
});

after(async () => {
  // Restore the seeded baseline (employee-level roles carry no permissions).
  try {
    const employeeRole = await roleModel.findByCode('EMPLOYEE', { companyId: null });

    if (employeeRole) {
      await rolePermissionModel.setForRole(employeeRole.id, []);
    }
  } catch {
    /* cleanup must not mask test results */
  }

  const userIds = Object.values(state.users)
    .map((user) => user.id)
    .filter(Boolean);

  if (userIds.length > 0) {
    await getPool().query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }
  if (state.customRoleIds.length > 0) {
    await getPool().query('DELETE FROM master_roles WHERE id = ANY($1)', [state.customRoleIds]);
  }
  if (state.companyIds.length > 0) {
    await getPool().query('DELETE FROM master_companies WHERE id = ANY($1)', [state.companyIds]);
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await closePool();
});

// ---------------------------------------------------------------------------
// 1. Administrator: global access, creates company owners across companies
// ---------------------------------------------------------------------------
test('Administrator can list and manage users across companies', async () => {
  const token = await login(state.users.admin.username);
  assert.ok(token, 'admin login should succeed');

  const list = await request('GET', '/api/users', { token });
  assert.equal(list.status, 200);

  const companyIdsInList = new Set(list.json.data.map((user) => user.company_id));
  assert.ok(companyIdsInList.has(state.companyA.id), 'sees company A users');
  assert.ok(companyIdsInList.has(state.companyB.id), 'sees company B users');

  const created = await request('POST', '/api/users', {
    token,
    body: {
      username: `ownerC_${suffix}`,
      password: BCRYPT_PASSWORD,
      roleCode: 'OWNER',
      companyId: state.companyB.id,
    },
  });

  assert.equal(created.status, 201);
  assert.equal(created.json.data.company_id, state.companyB.id);
  assert.equal(created.json.data.created_by_user_id, state.users.admin.id);
  state.users.ownerC = created.json.data;
});

// ---------------------------------------------------------------------------
// 2-3. Owner -> Manager / Employee in own company
// ---------------------------------------------------------------------------
test('Owner creates a Manager in the same company (created_by = owner)', async () => {
  const token = await login(state.users.ownerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `managerA2_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'MANAGER' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.json.data.company_id, state.companyA.id);
  assert.equal(response.json.data.created_by_user_id, state.users.ownerA.id);
  state.users.managerA2 = response.json.data;
});

test('Owner creates an Employee (Cleaner) in the same company', async () => {
  const token = await login(state.users.ownerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `cleanerOwner_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'CLEANER' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.json.data.company_id, state.companyA.id);
  assert.equal(response.json.data.created_by_user_id, state.users.ownerA.id);
  state.users.cleanerOwner = response.json.data;
});

// ---------------------------------------------------------------------------
// 4-5. Manager -> employee-level roles
// ---------------------------------------------------------------------------
test('Manager creates a Cleaner (employee-level)', async () => {
  const token = await login(state.users.managerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `cleanerMgr_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'CLEANER' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.json.data.company_id, state.companyA.id);
  assert.equal(response.json.data.created_by_user_id, state.users.managerA.id);
  state.users.cleanerMgr = response.json.data;
});

test('Manager creates a Driver (employee-level)', async () => {
  const token = await login(state.users.managerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `driverMgr_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'DRIVER' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.json.data.created_by_user_id, state.users.managerA.id);
  state.users.driverMgr = response.json.data;
});

// ---------------------------------------------------------------------------
// 6-8. Manager must not exceed its authority
// ---------------------------------------------------------------------------
test('Manager cannot create another Manager (equal hierarchy) -> 403', async () => {
  const token = await login(state.users.managerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `badMgr_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'MANAGER' },
  });

  assert.equal(response.status, 403);
  assert.match(response.json.message, /authority|hierarchy/i);
});

test('Manager cannot update the Owner (higher authority) -> 403', async () => {
  const token = await login(state.users.managerA.username);

  const response = await request('PUT', `/api/users/${state.users.ownerA.id}`, {
    token,
    body: { username: `hijacked_${suffix}` },
  });

  assert.equal(response.status, 403);
});

test('Manager cannot access another company (read or update) -> 403', async () => {
  const token = await login(state.users.managerA.username);

  const crossRead = await request('GET', `/api/users?companyId=${state.companyB.id}`, { token });
  assert.equal(crossRead.status, 403);

  const crossUpdate = await request('PUT', `/api/users/${state.users.employeeB.id}`, {
    token,
    body: { isValid: false },
  });
  assert.equal(crossUpdate.status, 403);
});

test('Manager list only returns its own subordinates', async () => {
  const token = await login(state.users.managerA.username);

  const response = await request('GET', '/api/users', { token });
  assert.equal(response.status, 200);

  const usernames = response.json.data.map((user) => user.username);
  assert.ok(!usernames.includes(state.users.ownerA.username), 'owner is hidden from manager');
  assert.ok(!usernames.includes(state.users.managerA.username), 'manager is not in its own list');
  assert.ok(usernames.includes(state.users.employeeA.username), 'employee is visible');
});


// ---------------------------------------------------------------------------
// 9-10. Employee has no management permissions
// ---------------------------------------------------------------------------
test('Employee cannot create users (no USER_CREATE) -> 403', async () => {
  const token = await login(state.users.employeeA.username);
  assert.ok(token, 'employee can log in');

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `empMade_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'CLEANER' },
  });

  assert.equal(response.status, 403);
  assert.match(response.json.message, /permission/i);
});

test('Employee cannot update a Manager -> 403', async () => {
  const token = await login(state.users.employeeA.username);

  const response = await request('PUT', `/api/users/${state.users.managerA.id}`, {
    token,
    body: { password: 'another-secret-1' },
  });

  assert.equal(response.status, 403);
});

// ---------------------------------------------------------------------------
// 11-12. Inactive user / inactive role / revoked permission
// ---------------------------------------------------------------------------
test('Inactive user cannot perform management operations -> 403', async () => {
  const response = await request('POST', '/api/users', {
    token: state.users.inactiveA.token,
    body: { username: `ghost_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'CLEANER' },
  });

  assert.equal(response.status, 403);
  assert.match(response.json.message, /inactive/i);
});

test('User whose role was deactivated loses access -> 403', async () => {
  const response = await request('GET', '/api/users', { token: state.users.frozenA.token });

  assert.equal(response.status, 403);
  assert.match(response.json.message, /role .*inactive/i);
});

test('Role with revoked permission cannot create users -> 403', async () => {
  const token = await login(state.users.limitedA.username);
  assert.ok(token, 'limited manager can log in (role active)');

  const allowed = await request('GET', '/api/users', { token });
  assert.equal(allowed.status, 200, 'USER_VIEW is still granted');

  const denied = await request('POST', '/api/users', {
    token,
    body: { username: `limitedMade_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'CLEANER' },
  });

  assert.equal(denied.status, 403);
  assert.match(denied.json.message, /USER_CREATE/);
});


// ---------------------------------------------------------------------------
// 13. Tampering with company_id / role_id / hierarchy escalation
// ---------------------------------------------------------------------------
test('Owner cannot create a user in another company -> 403', async () => {
  const token = await login(state.users.ownerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: {
      username: `crossCompany_${suffix}`,
      password: BCRYPT_PASSWORD,
      roleCode: 'EMPLOYEE',
      companyId: state.companyB.id,
    },
  });

  assert.equal(response.status, 403);
});

test('Owner cannot escalate to Administrator role -> 403', async () => {
  const token = await login(state.users.ownerA.username);

  const response = await request('POST', '/api/users', {
    token,
    body: { username: `ownerAdmin_${suffix}`, password: BCRYPT_PASSWORD, roleCode: 'ADMIN' },
  });

  assert.equal(response.status, 403);
});

test('Manager cannot promote an employee to Manager -> 403', async () => {
  const token = await login(state.users.managerA.username);

  const response = await request('PUT', `/api/users/${state.users.employeeA.id}`, {
    token,
    body: { roleCode: 'MANAGER' },
  });

  assert.equal(response.status, 403);
});

test('Employee cannot change its own role (no permission) -> 403', async () => {
  const token = await login(state.users.employeeA.username);

  const response = await request('PUT', `/api/users/${state.users.employeeA.id}`, {
    token,
    body: { roleCode: 'OWNER' },
  });

  assert.equal(response.status, 403);
});

test('Owner cannot modify an Administrator account -> 403', async () => {
  const token = await login(state.users.ownerA.username);

  const response = await request('PUT', `/api/users/${state.users.admin.id}`, {
    token,
    body: { isValid: false },
  });

  assert.equal(response.status, 403);
});

test('Manager cannot slip an unknown role / hierarchy value through the API', async () => {
  const token = await login(state.users.managerA.username);

  const fakeRole = await request('POST', '/api/users', {
    token,
    body: {
      username: `fakeRole_${suffix}`,
      password: BCRYPT_PASSWORD,
      roleCode: 'DOES_NOT_EXIST',
      hierarchyLevel: 999,
    },
  });

  assert.ok([400, 403].includes(fakeRole.status), `expected 400/403, got ${fakeRole.status}`);
});


// ---------------------------------------------------------------------------
// Role catalogue & permission administration
// ---------------------------------------------------------------------------
test('Role list exposes hierarchy levels and permissions', async () => {
  const token = await login(state.users.admin.username);

  const response = await request('GET', '/api/roles', { token });
  assert.equal(response.status, 200);

  const owner = response.json.data.find((role) => role.role_code === 'OWNER');
  const employee = response.json.data.find((role) => role.role_code === 'EMPLOYEE');

  assert.equal(owner.hierarchy_level, 200);
  assert.ok(owner.permissions.includes('USER_CREATE'));
  assert.equal(employee.hierarchy_level, 300);
  assert.deepEqual(employee.permissions, []);
});

test('Only the platform administrator can change role permissions', async () => {
  const ownerToken = await login(state.users.ownerA.username);
  const employeeRoleId = await roleIdFor('EMPLOYEE');

  const denied = await request('PUT', `/api/roles/${employeeRoleId}/permissions`, {
    token: ownerToken,
    body: { permissions: ['USER_VIEW'] },
  });
  assert.equal(denied.status, 403);

  const adminToken = await login(state.users.admin.username);
  const allowed = await request('PUT', `/api/roles/${employeeRoleId}/permissions`, {
    token: adminToken,
    body: { permissions: ['USER_VIEW'] },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.json.data.permissions, ['USER_VIEW']);

  // Restore the seeded configuration (employee-level roles have no permissions).
  await rolePermissionModel.setForRole(employeeRoleId, []);
});

