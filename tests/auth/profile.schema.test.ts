import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateProfileSchema } from '../../src/modules/auth/dto/auth.schema.js';

describe('update profile request schema', () => {
  it('trims a valid name and accepts a nullable avatar URL', () => {
    assert.deepEqual(updateProfileSchema.parse({ fullName: '  Trần Thị B  ', avatarUrl: null }), {
      fullName: 'Trần Thị B',
      avatarUrl: null,
    });
  });

  it('accepts a single field while rejecting empty, unknown, and invalid fields', () => {
    assert.deepEqual(updateProfileSchema.parse({ avatarUrl: 'https://example.test/avatar.png' }), {
      avatarUrl: 'https://example.test/avatar.png',
    });
    assert.equal(updateProfileSchema.safeParse({}).success, false);
    assert.equal(updateProfileSchema.safeParse({ fullName: ' ' }).success, false);
    assert.equal(
      updateProfileSchema.safeParse({ avatarUrl: 'javascript:alert(1)' }).success,
      false,
    );
    assert.equal(updateProfileSchema.safeParse({ email: 'new@example.test' }).success, false);
  });
});
