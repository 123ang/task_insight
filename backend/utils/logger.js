const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const configuredLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const activeLevel = LEVELS[configuredLevel] ?? LEVELS.debug;

const sensitiveKeys = new Set([
  'authorization',
  'cookie',
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'access_token',
  'refreshtoken',
  'refresh_token'
]);

const redactSensitive = (value, depth = 0) => {
  if (value == null || depth > 4) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }

  if (typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((redacted, [key, fieldValue]) => {
    redacted[key] = sensitiveKeys.has(key.toLowerCase())
      ? '[REDACTED]'
      : redactSensitive(fieldValue, depth + 1);
    return redacted;
  }, {});
};

const serializeError = (error) => {
  if (!error) {
    return undefined;
  }
  if (!(error instanceof Error)) {
    return redactSensitive(error);
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  };
};

const write = (level, message, meta) => {
  if (LEVELS[level] > activeLevel) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: redactSensitive(meta) } : {})
  };

  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
};

const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
  serializeError
};

module.exports = {
  logger,
  redactSensitive
};
