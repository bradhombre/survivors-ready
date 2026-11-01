# Project rules
- Password recovery uses the existing Cloud Auth client and a public `/reset-password` route; only a verified recovery session enables the form, never an ordinary sign-in session.
- Password-setting forms share validation, while signed-in changes support current-password verification and recovery changes never send a current password.