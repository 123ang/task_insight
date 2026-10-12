const sameOrganization = (left, right) => (
  left &&
  right &&
  left.organization_id != null &&
  left.organization_id === right.organization_id
);

const canChangeUserPassword = ({ requester, targetUser }) => {
  if (!requester || !targetUser) {
    return false;
  }
  if (requester.id === targetUser.id) {
    return true;
  }
  if (requester.role === 'platform_owner') {
    return true;
  }
  if (requester.role !== 'organization_admin') {
    return false;
  }
  if (targetUser.role === 'platform_owner') {
    return false;
  }
  return sameOrganization(requester, targetUser);
};

const canReadFolder = ({ user, folder }) => {
  if (!user || !folder) {
    return false;
  }
  if (user.role === 'platform_owner') {
    return true;
  }
  return sameOrganization(user, folder);
};

const canManageFolder = ({ user, folder }) => {
  if (!canReadFolder({ user, folder })) {
    return false;
  }
  if (user.role === 'platform_owner' || user.role === 'organization_admin') {
    return true;
  }
  return folder.created_by === user.id;
};

module.exports = {
  canChangeUserPassword,
  canManageFolder,
  canReadFolder
};
