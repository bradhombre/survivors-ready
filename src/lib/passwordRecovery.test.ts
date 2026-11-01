import { describe, it, expect } from 'bun:test';
import { isRecoverySessionValid, newPasswordSchema } from './passwordRecovery';

describe('password recovery rules', () => {
  it('requires at least 6 characters', () => {
    expect(newPasswordSchema.safeParse({ password: '12345', confirmPassword: '12345' }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: '123456', confirmPassword: '123456' }).success).toBe(true);
  });
  it('requires matching passwords', () => {
    expect(newPasswordSchema.safeParse({ password: '123456', confirmPassword: '654321' }).success).toBe(false);
  });
  it('rejects ordinary signed-in sessions', () => {
    expect(isRecoverySessionValid({ access_token: 'ordinary' }, null, false)).toBe(false);
  });
  it('accepts only the session established by the recovery link', () => {
    expect(isRecoverySessionValid({ access_token: 'recovery' }, 'recovery', false)).toBe(true);
    expect(isRecoverySessionValid({ access_token: 'ordinary' }, 'recovery', false)).toBe(false);
  });
  it('rejects URL errors and missing sessions', () => {
    expect(isRecoverySessionValid({ access_token: 'recovery' }, 'recovery', true)).toBe(false);
    expect(isRecoverySessionValid(null, 'recovery', false)).toBe(false);
  });
});