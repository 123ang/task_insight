const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../config/database');
const { logger } = require('../utils/logger');

const migrationsDir = path.join(__dirname, '..', 'migrations');

const splitStatements = (sql) => {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement && !statement.startsWith('--'));
};

const ensureMigrationsTable = async(connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getAppliedMigrations = async(connection) => {
  const [rows] = await connection.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
};

const runMigration = async(connection, filename) => {
  const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
  const statements = splitStatements(sql);

  await connection.beginTransaction();
  try {
    for (const statement of statements) {
      await connection.query(statement);
    }

    await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
    await connection.commit();
    logger.info('Migration applied', { filename });
  } catch (error) {
    await connection.rollback();
    logger.error('Migration failed', { filename, error: logger.serializeError(error) });
    throw error;
  }
};

const run = async() => {
  const connection = await pool.getConnection();

  try {
    await ensureMigrationsTable(connection);
    const appliedMigrations = await getAppliedMigrations(connection);
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      if (appliedMigrations.has(filename)) {
        logger.debug('Migration already applied', { filename });
        continue;
      }

      await runMigration(connection, filename);
    }

    logger.info('Migrations complete');
  } finally {
    connection.release();
    await pool.end();
  }
};

if (require.main === module) {
  run().catch(() => {
    process.exit(1);
  });
}

module.exports = {
  run,
  splitStatements
};
