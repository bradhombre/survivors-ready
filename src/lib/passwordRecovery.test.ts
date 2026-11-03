/// <reference types="node" />
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { changePasswordChecked, isRecoveryLink, isRecoverySessionValid, newPasswordSchema, resetRequestErrorMessage } from './passwordRecovery';

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
  it('spots a reset link from its hash', () => {
    assert.equal(isRecoveryLink('#access_token=abc&type=recovery'), true);
    assert.equal(isRecoveryLink('access_token=abc&type=recovery'), true);
    assert.equal(isRecoveryLink('#access_token=abc&type=signup'), false);
    assert.equal(isRecoveryLink('#error=access_denied&error_code=otp_expired'), false);
    assert.equal(isRecoveryLink(''), false);
  });
  it('explains send errors instead of claiming the email went out', () => {
    assert.equal(resetRequestErrorMessage(null), null);
    assert.match(resetRequestErrorMessage({ status: 429 }) ?? '', /wait a minute/);
    assert.match(resetRequestErrorMessage({ status: 400, code: 'over_email_send_rate_limit' }) ?? '', /wait a minute/);
    assert.match(resetRequestErrorMessage({ status: 500 }) ?? '', /couldn't send/);
    assert.match(resetRequestErrorMessage({}) ?? '', /couldn't send/);
  });
  describe('signed-in password change', () => {
    const setup = (signInError: { message: string; code?: string } | null = null, updateError: { message: string } | null = null) => {
      const calls: string[] = [];
      return {
        calls,
        signIn: async (email: string, password: string) => { calls.push(`signIn:${email}:${password}`); return { error: signInError }; },
        updatePassword: async (password: string) => { calls.push(`update:${password}`); return { error: updateError }; },
      };
    };
    it('refuses a wrong current password and changes nothing', async () => {
      const d = setup({ message: 'Invalid login credentials', code: 'invalid_credentials' });
      await assert.rejects(changePasswordChecked({ email: 'a@b.com', currentPassword: 'wrong1', newPassword: 'newpass', requireCurrent: true, ...d }), /current password is incorrect/);
      assert.deepEqual(d.calls, ['signIn:a@b.com:wrong1']);
    });
    it('changes the password after the current one checks out', async () => {
      const d = setup();
      await changePasswordChecked({ email: 'a@b.com', currentPassword: 'right1', newPassword: 'newpass', requireCurrent: true, ...d });
      assert.deepEqual(d.calls, ['signIn:a@b.com:right1', 'update:newpass']);
    });
    it('requires the current password for email accounts', async () => {
      const d = setup();
      await assert.rejects(changePasswordChecked({ email: 'a@b.com', newPassword: 'newpass', requireCurrent: true, ...d }), /Enter your current password/);
      assert.deepEqual(d.calls, []);
    });
    it('lets a Google-only account set a password without one', async () => {
      const d = setup();
      await changePasswordChecked({ email: 'a@b.com', newPassword: 'newpass', requireCurrent: false, ...d });
      assert.deepEqual(d.calls, ['update:newpass']);
    });
    it('passes other sign-in problems through instead of calling them a wrong password', async () => {
      const d = setup({ message: 'Request rate limit reached', code: 'over_request_rate_limit' });
      await assert.rejects(changePasswordChecked({ email: 'a@b.com', currentPassword: 'right1', newPassword: 'newpass', requireCurrent: true, ...d }), /rate limit/);
      assert.deepEqual(d.calls, ['signIn:a@b.com:right1']);
    });
    it('reports a failed update', async () => {
      const d = setup(null, { message: 'New password should be different from the old password.' });
      await assert.rejects(changePasswordChecked({ email: 'a@b.com', currentPassword: 'right1', newPassword: 'right1', requireCurrent: true, ...d }), /different from the old password/);
    });
  });
});
