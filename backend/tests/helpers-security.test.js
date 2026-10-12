const {
  generateInvitationCode,
  validatePassword
} = require('../utils/helpers');

describe('security helpers', () => {
  it('generates high-entropy invitation codes without ambiguous characters', () => {
    const code = generateInvitationCode();

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });

  it('requires a practical password policy for new and changed passwords', () => {
    expect(validatePassword('Short123').isValid).toBe(false);
    expect(validatePassword('longbutnonumbers').isValid).toBe(false);
    expect(validatePassword('longbutnoupper123').isValid).toBe(false);
    expect(validatePassword('LongEnough123').isValid).toBe(true);
  });
});
