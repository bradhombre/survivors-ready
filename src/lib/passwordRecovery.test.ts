/// <reference types="node" />
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isRecoverySessionValid, newPasswordSchema } from './passwordRecovery';

describe('password recovery rules', () => {
  it('requires at least 6 characters', () => {
    assert.equal(newPasswordSchema.safeParse({ password: '12345', confirmPassword: '12345' }).success, false);
    assert.equal(newPasswordSchema.safeParse({ password: '123456', confirmPassword: '123456' }).success, true);
  });
  it('requires matching passwords', () => {
    assert.equal(newPasswordSchema.safeParse({ password: '123456', confirmPassword: '654321' }).success, false);
  });
  it('rejects ordinary signed-in sessions', () => {
    assert.equal(isRecoverySessionValid({ access_token: 'ordinary' }, null, false), false);
  });
  it('accepts only the session established by the recovery link', () => {
    assert.equal(isRecoverySessionValid({ access_token: 'recovery' }, 'recovery', false), true);
    assert.equal(isRecoverySessionValid({ access_token: 'ordinary' }, 'recovery', false), false);
  });
  it('rejects URL errors and missing sessions', () => {
    assert.equal(isRecoverySessionValid({ access_token: 'recovery' }, 'recovery', true), false);
    assert.equal(isRecoverySessionValid(null, 'recovery', false), false);
  });
});