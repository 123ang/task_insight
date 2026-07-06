const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { testConnection } = require('./config/database');
const {
  getAllowedCorsOrigins,
  getFrameAncestors,
  isOriginAllowed,
  validateRequiredSecurityConfig,
} = require('./config/security');
const { logger, redactSensitive } = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const organizationRoutes = require('./routes/organizations');
const fileRoutes = require('./routes/files');
const adminRoutes = require('./routes/admin');
const auditRoutes = require('./routes/audit');
const reminderRoutes = require('./routes/reminders');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

// Security middleware - Configure helmet to allow iframe embedding for previews
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-ancestors': getFrameAncestors(),
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for previews
}));

// CORS configuration
const allowedCorsOrigins = getAllowedCorsOrigins();
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedCorsOrigins)) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const areRateLimitsDisabled = () => process.env.DISABLE_RATE_LIMITS === 'true';
const skipRateLimit = () => process.env.NODE_ENV === 'test' || areRateLimitsDisabled();
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 300,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
});
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10) || 50,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
});

app.use(globalLimiter);

// Compression middleware
app.use(compression());

// Keep automated test output focused on assertions.
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Body parsing middleware
// Note: For file uploads, multer handles size limits separately
// These limits are for JSON/URL-encoded data
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || '1mb' }));

// Increase server timeout for large file uploads (2 hours)
// This is important for uploads of files up to 2GB
const serverTimeout = parseInt(process.env.SERVER_TIMEOUT) || 7200000; // 2 hours default

// Uploaded documents are served only through authenticated file routes.

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reminders', reminderRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Global error handler', {
    message: error.message,
    code: error.code,
    status: error.status,
    url: req.url,
    method: req.method,
    contentType: req.headers['content-type'],
    body: redactSensitive(req.body),
    stack: error.stack
  });
  
  // Handle JSON parse errors
  if (error instanceof SyntaxError && error.message.includes('JSON')) {
    logger.warn('Invalid JSON request body', {
      body: redactSensitive(req.body),
      bodyType: typeof req.body,
      headers: redactSensitive(req.headers)
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON in request body. Please check your request data.',
      error: error.message
    });
  }
  
  // Handle multer errors that weren't caught
  if (error.code === 'LIMIT_FILE_SIZE') {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 2 * 1024 * 1024 * 1024;
    const maxSizeGB = (maxSize / (1024 * 1024 * 1024)).toFixed(2);
    return res.status(400).json({
      success: false,
      message: `File too large. Maximum file size is ${maxSizeGB} GB.`
    });
  }
  
  const status = error.status || 500;
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : (error.message || 'Request failed'),
    ...(process.env.NODE_ENV === 'development' && { 
      stack: error.stack,
      code: error.code 
    })
  });
});

// Start server
const startServer = async () => {
  try {
    validateRequiredSecurityConfig();

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.warn('Server starting without database connection');
    }

    const server = app.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        apiBaseUrl: `http://localhost:${PORT}/api`,
        serverTimeoutMs: serverTimeout
      });
    });
    
    // Set server timeout for large file uploads
    server.timeout = serverTimeout;
    server.keepAliveTimeout = serverTimeout;
    server.headersTimeout = serverTimeout + 1000; // Slightly longer than keepAliveTimeout
  } catch (error) {
    logger.error('Failed to start server', { error: logger.serializeError(error) });
    process.exit(1);
  }
};

const registerProcessHandlers = () => {
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err, promise) => {
    logger.error('Unhandled promise rejection', { promise, error: logger.serializeError(err) });
    process.exit(1);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: logger.serializeError(err) });
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
};

if (require.main === module) {
  registerProcessHandlers();
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
