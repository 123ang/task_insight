const { body, param, query, validationResult } = require('express-validator');
const { validatePassword } = require('../utils/helpers');
const { logger, redactSensitive } = require('../utils/logger');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      errors: errors.array(),
      body: redactSensitive(req.body),
      file: req.file ? { name: req.file.originalname, size: req.file.size } : 'no file'
    });
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User validation rules
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .custom((value) => {
      const result = validatePassword(value);
      if (!result.isValid) {
        throw new Error(result.errors.join('. '));
      }
      return true;
    }),
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be between 1 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be between 1 and 50 characters'),
  body('organizationId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Organization ID must be a positive integer'),
  handleValidationErrors
];

const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

const validateUserUpdate = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be between 1 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be between 1 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('role')
    .optional()
    .isIn(['member', 'organization_admin'])
    .withMessage('Role must be either member or organization_admin'),
  handleValidationErrors
];

// Organization validation rules
const validateOrganization = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Organization name must be between 1 and 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('storageQuota')
    .optional()
    .custom((value) => {
      const numValue = Number(value);
      if (isNaN(numValue) || numValue < 0) {
        throw new Error('Storage quota must be a positive number');
      }
      const minBytes = 100 * 1024 * 1024; // 100MB in bytes
      const maxBytes = 10 * 1024 * 1024 * 1024 * 1024; // 10TB in bytes
      if (numValue < minBytes || numValue > maxBytes) {
        throw new Error('Storage quota must be between 100MB and 10TB');
      }
      return true;
    }),
  handleValidationErrors
];

// File validation rules
const validateFileUpload = [
  body('name')
    .optional() // Make name optional - can use original filename if not provided
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('File name must be between 1 and 255 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must not exceed 1000 characters'),
  body('folderId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Folder ID must be a positive integer'),
  handleValidationErrors
];

const validateFileUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('File name must be between 1 and 255 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must not exceed 1000 characters'),
  handleValidationErrors
];

// Folder validation rules
const validateFolder = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Folder name must be between 1 and 255 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must not exceed 1000 characters'),
  body('parentId')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Parent folder ID must be a positive integer'),
  handleValidationErrors
];

// Invitation validation rules
const validateInvitation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('organizationId')
    .isInt({ min: 1 })
    .withMessage('Organization ID must be a positive integer'),
  body('role')
    .isIn(['member', 'organization_admin'])
    .withMessage('Role must be either member or organization_admin'),
  handleValidationErrors
];

// Parameter validation rules
const validateId = [
  param('id').isInt({ min: 1 }).withMessage('ID must be a positive integer'),
  handleValidationErrors
];

const validateFileId = [
  param('fileId').isInt({ min: 1 }).withMessage('File ID must be a positive integer'),
  handleValidationErrors
];

const validateOrgId = [
  param('orgId').isInt({ min: 1 }).withMessage('Organization ID must be a positive integer'),
  handleValidationErrors
];

// Query validation rules
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

const validateSearch = [
  query('q')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters'),
  handleValidationErrors
];

const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  handleValidationErrors
];

module.exports = {
  validateUserRegistration,
  validateUserLogin,
  validateUserUpdate,
  validateOrganization,
  validateFileUpload,
  validateFileUpdate,
  validateFolder,
  validateInvitation,
  validateId,
  validateFileId,
  validateOrgId,
  validatePagination,
  validateSearch,
  validateDateRange,
  handleValidationErrors
};
