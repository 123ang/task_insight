const {
  canChangeUserPassword,
  canManageFolder,
  canReadFolder
} = require('../utils/authorization');

describe('authorization helpers', () => {
  describe('canChangeUserPassword', () => {
    it('allows users to change their own password', () => {
      expect(canChangeUserPassword({
        requester: { id: 10, role: 'member', organization_id: 1 },
        targetUser: { id: 10, role: 'member', organization_id: 2 }
      })).toBe(true);
    });

    it('denies organization admins changing users in another organization', () => {
      expect(canChangeUserPassword({
        requester: { id: 10, role: 'organization_admin', organization_id: 1 },
        targetUser: { id: 20, role: 'member', organization_id: 2 }
      })).toBe(false);
    });

    it('allows organization admins changing users in their organization', () => {
      expect(canChangeUserPassword({
        requester: { id: 10, role: 'organization_admin', organization_id: 1 },
        targetUser: { id: 20, role: 'member', organization_id: 1 }
      })).toBe(true);
    });

    it('allows platform owners to change any user password', () => {
      expect(canChangeUserPassword({
        requester: { id: 10, role: 'platform_owner', organization_id: null },
        targetUser: { id: 20, role: 'member', organization_id: 2 }
      })).toBe(true);
    });
  });

  describe('folder authorization', () => {
    it('allows folder owners to manage their folder', () => {
      expect(canManageFolder({
        user: { id: 10, role: 'member', organization_id: 1 },
        folder: { created_by: 10, organization_id: 1 }
      })).toBe(true);
    });

    it('denies same-organization members managing another user folder', () => {
      expect(canManageFolder({
        user: { id: 10, role: 'member', organization_id: 1 },
        folder: { created_by: 20, organization_id: 1 }
      })).toBe(false);
    });

    it('allows organization admins to manage folders in their organization', () => {
      expect(canManageFolder({
        user: { id: 10, role: 'organization_admin', organization_id: 1 },
        folder: { created_by: 20, organization_id: 1 }
      })).toBe(true);
    });

    it('allows same-organization members to read but not manage another user folder', () => {
      const user = { id: 10, role: 'member', organization_id: 1 };
      const folder = { created_by: 20, organization_id: 1 };

      expect(canReadFolder({ user, folder })).toBe(true);
      expect(canManageFolder({ user, folder })).toBe(false);
    });
  });
});
