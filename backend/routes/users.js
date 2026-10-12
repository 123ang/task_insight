const express = require('express');
const bcrypt = require('bcrypt');
const { executeQuery } = require('../config/database');
const { verifyToken, requireOrgAdmin, requireOrgAccess } = require('../middleware/auth');
const { validateUserUpdate, validatePagination, validateSearch } = require('../middleware/validation');
const { canChangeUserPassword } = require('../utils/authorization');
const { validatePassword } = require('../utils/helpers');

const router = express.Router();

// Create user (platform owner or org admin)
router.post('/', verifyToken, requireOrgAdmin, async(req, res) => {
  try {
    const { email, password, firstName, lastName, organizationId, role = 'member' } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, first name, and last name are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.errors.join('. ')
      });
    }

    // Determine organization ID
    let targetOrgId = organizationId;
    if (req.user.role === 'organization_admin') {
      // Org admins can only create users in their own organization
      targetOrgId = req.user.organization_id;
    } else if (req.user.role === 'platform_owner') {
      // Platform owners must specify an organization
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }
      // Validate organization exists
      const orgCheck = await executeQuery(
        'SELECT id FROM organizations WHERE id = ? AND status = "active"',
        [organizationId]
      );
      if (!orgCheck.success || orgCheck.data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Organization not found'
        });
      }
    }

    // Check if email already exists
    const existingUser = await executeQuery(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.success && existingUser.data.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already registered'
      });
    }

    // Validate role
    const allowedRoles = ['member', 'organization_admin'];
    if (req.user.role === 'platform_owner') {
      allowedRoles.push('platform_owner');
    }
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const createResult = await executeQuery(
      `INSERT INTO users (email, password_hash, first_name, last_name, organization_id, role, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())`,
      [email, hashedPassword, firstName, lastName, targetOrgId, role]
    );

    if (!createResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }

    const userId = createResult.data.insertId;

    // Log the creation
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, targetOrgId, 'CREATE', 'USER', userId, JSON.stringify({ email, firstName, lastName, role })]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        userId,
        email,
        firstName,
        lastName,
        organizationId: targetOrgId,
        role
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all users (platform owner or org admin)
router.get('/', verifyToken, validatePagination, validateSearch, async(req, res) => {
  try {
    const { page = 1, limit = 10, q: search, organizationId, role, status } = req.query;
    const offset = (page - 1) * limit;

    const whereConditions = [];
    const queryParams = [];

    // Platform owner can see all users, org admin only sees their org users
    if (req.user.role === 'organization_admin') {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(req.user.organization_id);
    } else if (req.user.role !== 'platform_owner') {
      // Regular members cannot access this endpoint
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Search filter
    if (search) {
      whereConditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    // Organization filter
    if (organizationId) {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(organizationId);
    }

    // Role filter
    if (role) {
      whereConditions.push('u.role = ?');
      queryParams.push(role);
    }

    // Status filter
    if (status) {
      whereConditions.push('u.status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get users with pagination
    const usersQuery = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status, 
             u.organization_id, u.created_at, u.last_login, o.name as organization_name
      FROM users u 
      LEFT JOIN organizations o ON u.organization_id = o.id 
      ${whereClause}
      ORDER BY u.created_at DESC 
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;

    const usersResult = await executeQuery(usersQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM users u 
      LEFT JOIN organizations o ON u.organization_id = o.id 
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!usersResult.success || !countResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }

    // Map snake_case to camelCase for frontend
    const mappedUsers = usersResult.data.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      role: user.role,
      organizationId: user.organization_id,
      organizationName: user.organization_name || '',
      status: user.status,
      last_login: user.last_login,
      created_at: user.created_at
    }));

    res.json({
      success: true,
      data: {
        data: mappedUsers,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get user by ID
router.get('/:id', verifyToken, requireOrgAccess, async(req, res) => {
  try {
    const { id } = req.params;

    const userResult = await executeQuery(
      'SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status, u.created_at, u.last_login, o.name as organization_name FROM users u LEFT JOIN organizations o ON u.organization_id = o.id WHERE u.id = ?',
      [id]
    );

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userResult.data[0]
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user
router.put('/:id', verifyToken, requireOrgAdmin, validateUserUpdate, async(req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, role, status, organizationId } = req.body;

    // Check if user exists
    const existingUser = await executeQuery(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );

    if (!existingUser.success || existingUser.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = existingUser.data[0];

    // Check permissions
    if (req.user.role === 'organization_admin') {
      if (user.organization_id !== req.user.organization_id) {
        return res.status(403).json({
          success: false,
          message: 'You can only update users in your organization'
        });
      }
      // Org admins cannot change organization_id
      if (organizationId && organizationId !== user.organization_id) {
        return res.status(403).json({
          success: false,
          message: 'You cannot change user organization'
        });
      }
    }

    // Platform owners can change organization_id, but validate it exists
    if (organizationId && req.user.role === 'platform_owner') {
      const orgCheck = await executeQuery(
        'SELECT id FROM organizations WHERE id = ?',
        [organizationId]
      );
      if (!orgCheck.success || orgCheck.data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Organization not found'
        });
      }
    }

    // Check if email is already taken by another user
    if (email && email !== user.email) {
      const emailCheck = await executeQuery(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );

      if (emailCheck.success && emailCheck.data.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken'
        });
      }
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];

    if (firstName) {
      updateFields.push('first_name = ?');
      updateValues.push(firstName);
    }

    if (lastName) {
      updateFields.push('last_name = ?');
      updateValues.push(lastName);
    }

    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }

    if (role) {
      updateFields.push('role = ?');
      updateValues.push(role);
    }

    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    if (organizationId && req.user.role === 'platform_owner') {
      updateFields.push('organization_id = ?');
      updateValues.push(organizationId);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(id);

    const updateResult = await executeQuery(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update user'
      });
    }

    // Log the update
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'UPDATE', 'USER', id, JSON.stringify({ updatedFields: updateFields })]
    );

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Change user password
router.put('/:id/password', verifyToken, async(req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;
    const targetUserId = parseInt(id, 10);

    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Get user
    const userResult = await executeQuery(
      'SELECT id, password_hash, organization_id, role, status FROM users WHERE id = ?',
      [targetUserId]
    );

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const targetUser = userResult.data[0];

    if (!canChangeUserPassword({ requester: req.user, targetUser })) {
      return res.status(403).json({
        success: false,
        message: 'You can only change your own password or users in your organization'
      });
    }

    // Verify current password (except for admin changing other user's password)
    if (req.user.id === targetUserId) {
      const isValidPassword = await bcrypt.compare(currentPassword, targetUser.password_hash);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
    }

    // Validate new password
    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.errors.join('. ')
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    const updateResult = await executeQuery(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hashedPassword, targetUserId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update password'
      });
    }

    // Log password change
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'UPDATE', 'USER', targetUserId, JSON.stringify({ action: 'password_change' })]
    );

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete user (soft delete)
router.delete('/:id', verifyToken, requireOrgAdmin, async(req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const userResult = await executeQuery(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.data[0];

    // Check permissions
    if (req.user.role === 'organization_admin' && user.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete users in your organization'
      });
    }

    // Cannot delete yourself
    if (req.user.id === parseInt(id, 10)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    // Soft delete user
    const deleteResult = await executeQuery(
      'UPDATE users SET status = "deleted", deleted_at = NOW() WHERE id = ?',
      [id]
    );

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user'
      });
    }

    // Log deletion
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'DELETE', 'USER', id, JSON.stringify({ email: user.email })]
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get user statistics
router.get('/stats/overview', verifyToken, requireOrgAdmin, async(req, res) => {
  try {
    const { organizationId } = req.query;

    let whereClause = '';
    const queryParams = [];

    if (req.user.role === 'organization_admin') {
      whereClause = 'WHERE organization_id = ?';
      queryParams.push(req.user.organization_id);
    } else if (organizationId) {
      whereClause = 'WHERE organization_id = ?';
      queryParams.push(organizationId);
    }

    // Get user counts by status
    const statusStats = await executeQuery(
      `SELECT status, COUNT(*) as count FROM users ${whereClause} GROUP BY status`,
      queryParams
    );

    // Get user counts by role
    const roleStats = await executeQuery(
      `SELECT role, COUNT(*) as count FROM users ${whereClause} GROUP BY role`,
      queryParams
    );

    // Get total users
    const totalUsers = await executeQuery(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      queryParams
    );

    // Get recent registrations (last 30 days)
    const recentRegistrations = await executeQuery(
      `SELECT COUNT(*) as count FROM users ${whereClause} AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      queryParams
    );

    if (!statusStats.success || !roleStats.success || !totalUsers.success || !recentRegistrations.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user statistics'
      });
    }

    res.json({
      success: true,
      data: {
        totalUsers: totalUsers.data[0].total,
        statusStats: statusStats.data,
        roleStats: roleStats.data,
        recentRegistrations: recentRegistrations.data[0].count
      }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
