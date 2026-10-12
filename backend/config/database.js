const mysql = require('mysql2/promise');
require('dotenv').config();
const { logger } = require('../utils/logger');

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'task_insight',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
  // Ensure UTF-8 encoding for all connections
  typeCast(field, next) {
    if (field.type === 'VAR_STRING' || field.type === 'STRING' || field.type === 'TEXT') {
      return field.string();
    }
    return next();
  }
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Set charset on every new connection
pool.on('connection', (connection) => {
  connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) => {
    if (err) {
      logger.error('Failed to set charset on connection', { error: logger.serializeError(err) });
    }
  });
});

// Test database connection
const testConnection = async() => {
  try {
    const connection = await pool.getConnection();
    logger.info('Database connected successfully');
    connection.release();
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error: logger.serializeError(error) });
    return false;
  }
};

// Execute query with error handling
const executeQuery = async(query, params = []) => {
  try {
    // Use pool.execute which automatically manages connections
    // The charset is set via the pool's 'connection' event handler
    const [results] = await pool.execute(query, params);
    return { success: true, data: results };
  } catch (error) {
    logger.error('Database query error', { error: logger.serializeError(error) });
    return { success: false, error: error.message };
  }
};

// Get connection from pool
const getConnection = async() => {
  try {
    return await pool.getConnection();
  } catch (error) {
    logger.error('Failed to get database connection', { error: logger.serializeError(error) });
    throw error;
  }
};

module.exports = {
  pool,
  testConnection,
  executeQuery,
  getConnection
};
