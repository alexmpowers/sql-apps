import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFor, parseCurrentUser } from '../src/access.js';

const identity = {
  oid: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

test('application access is allowed when no role is required', () => {
  assert.deepEqual(accessFor(identity), { allowed: true });
});

test('application access requires an exact case-sensitive role match', () => {
  assert.deepEqual(accessFor(identity, 'AppUser'), { allowed: false, requiredRole: 'AppUser' });
  assert.deepEqual(accessFor({ ...identity, roles: ['AppUser'] }, 'AppUser'), { allowed: true });
  assert.deepEqual(accessFor({ ...identity, roles: ['appuser'] }, 'AppUser'),
    { allowed: false, requiredRole: 'AppUser' });
});

test('current-user parsing retains top-level identity and granted application access', () => {
  const currentUser = { ...identity, roles: ['AppUser'], access: { allowed: true } };
  assert.deepEqual(parseCurrentUser(currentUser), currentUser);
  const withoutRoles = { ...identity, access: { allowed: true } };
  assert.deepEqual(parseCurrentUser(withoutRoles), withoutRoles);
});

test('current-user parsing retains denied access and its required role', () => {
  const currentUser = { ...identity, roles: [], access: { allowed: false, requiredRole: 'AppUser' } };
  assert.deepEqual(parseCurrentUser(currentUser), currentUser);
});

test('current-user parsing rejects malformed identities or application access', () => {
  const currentUser = { ...identity, roles: ['AppUser'], access: { allowed: true } };
  for (const value of [
    null,
    {},
    { ...identity },
    { ...identity, access: {} },
    { ...identity, access: null },
    { ...identity, access: [] },
    { ...identity, access: { allowed: 'yes' } },
    { ...identity, access: { allowed: false } },
    { ...identity, access: { allowed: false, requiredRole: '' } },
    { ...identity, access: { allowed: false, requiredRole: '   ' } },
    { ...currentUser, roles: 'AppUser' },
    { ...currentUser, roles: [1] },
    { ...currentUser, oid: '' },
    { ...currentUser, tenantId: '' },
  ]) {
    assert.throws(() => parseCurrentUser(value), /Invalid current-user response/);
  }
});
