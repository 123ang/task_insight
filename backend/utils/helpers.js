const crypto = require('crypto');

// Generate random string
const generateRandomString = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate invitation code (6 random letters and numbers)
const generateInvitationCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars like 0, O, I, 1
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
};

// Format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// Format date
const formatDate = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
  if (!date) {
    return null;
  }

  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
};

// Validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate password strength
const validatePassword = (password) => {
  const errors = [];
  const value = password || '';

  if (value.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }

  if (!/[a-z]/.test(value)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(value)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/\d/.test(value)) {
    errors.push('Password must contain at least one number');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// Sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
};

// Get file extension
const getFileExtension = (filename) => {
  return filename.split('.').pop().toLowerCase();
};

// Check if file type is allowed
const isAllowedFileType = (filename, allowedTypes) => {
  const extension = getFileExtension(filename);
  return allowedTypes.includes(extension);
};

// Calculate pagination
const calculatePagination = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;

  return {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    total,
    totalPages,
    offset,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
};

// Generate search query conditions
const generateSearchConditions = (searchTerm, searchFields) => {
  if (!searchTerm || !searchFields || searchFields.length === 0) {
    return { conditions: [], params: [] };
  }

  const conditions = [];
  const params = [];
  const searchPattern = `%${searchTerm}%`;

  searchFields.forEach(field => {
    conditions.push(`${field} LIKE ?`);
    params.push(searchPattern);
  });

  return {
    conditions: [`(${conditions.join(' OR ')})`],
    params
  };
};

// Generate date range conditions
const generateDateRangeConditions = (startDate, endDate, dateField = 'created_at') => {
  const conditions = [];
  const params = [];

  if (startDate) {
    conditions.push(`${dateField} >= ?`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`${dateField} <= ?`);
    params.push(endDate);
  }

  return { conditions, params };
};

// Generate audit log details
const generateAuditDetails = (data) => {
  try {
    return JSON.stringify(data);
  } catch (error) {
    return JSON.stringify({ error: 'Failed to serialize data' });
  }
};

// Parse audit log details
const parseAuditDetails = (details) => {
  try {
    return JSON.parse(details || '{}');
  } catch (error) {
    return {};
  }
};

// Generate error response
const generateErrorResponse = (message, statusCode = 400, errors = null) => {
  const response = {
    success: false,
    message
  };

  if (errors) {
    response.errors = errors;
  }

  return { response, statusCode };
};

// Generate success response
const generateSuccessResponse = (message, data = null, statusCode = 200) => {
  const response = {
    success: true,
    message
  };

  if (data) {
    response.data = data;
  }

  return { response, statusCode };
};

// Deep clone object
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

// Check if value is empty
const isEmpty = (value) => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
};

// Truncate string
const truncateString = (str, maxLength = 100, suffix = '...') => {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - suffix.length) + suffix;
};

// Generate slug from string
const generateSlug = (str) => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');
};

// Validate UUID format
const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// Generate UUID v4
const generateUUID = () => {
  return crypto.randomUUID();
};

// Calculate percentage
const calculatePercentage = (value, total) => {
  if (total === 0) {
    return 0;
  }
  return Math.round((value / total) * 100 * 100) / 100; // Round to 2 decimal places
};

// Sleep function for async operations
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Retry function for async operations
const retry = async(fn, maxAttempts = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(delay * attempt);
    }
  }
};

module.exports = {
  generateRandomString,
  generateInvitationCode,
  formatFileSize,
  formatDate,
  isValidEmail,
  validatePassword,
  sanitizeFilename,
  getFileExtension,
  isAllowedFileType,
  calculatePagination,
  generateSearchConditions,
  generateDateRangeConditions,
  generateAuditDetails,
  parseAuditDetails,
  generateErrorResponse,
  generateSuccessResponse,
  deepClone,
  isEmpty,
  truncateString,
  generateSlug,
  isValidUUID,
  generateUUID,
  calculatePercentage,
  sleep,
  retry
};
