'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Single-file logging framework for the whole backend.
 *
 * Two things live here (deliberately in one file, no dependencies):
 *
 * 1. `logger` — a tiny level-aware console logger used for every "action" log
 *    (startup, DB, seed, errors). Levels: debug < info < warn < error,
 *    controlled by `LOG_LEVEL`.
 * 2. `requestLogger` — a servlet-style **filter chain** middleware:
 *    `attachRequestId -> logRequestStart -> logRequestComplete`, so every HTTP
 *    request prints one line in, one line out (endpoint + status + duration).
 *
 * Environment:
 *   LOG_LEVEL=debug|info|warn|error   (default: info)
 *   LOG_REQUEST_BODY=true|false       (default: false; sensitive keys redacted)
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
};
const RESET = '\u001b[0m';
const MAX_STRING_LENGTH = 200;

// Keys whose values must never reach the console (passwords, tokens, keys).
const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'x-admin-key',
  'jwt',
  'jwtsecret',
  'adminapikey',
]);

const colourise = (level) => {
  const label = level.toUpperCase().padEnd(5);
  const colour = COLORS[level];
  return colour && process.stdout.isTTY && !process.env.NO_COLOR
    ? `${colour}${label}${RESET}`
    : label;
};

const activeLevel = () => LEVELS[String(process.env.LOG_LEVEL ?? '').toLowerCase()] ?? LEVELS.info;

const isEnabled = (level) => LEVELS[level] >= activeLevel();

/** Recursively masks sensitive keys and trims very long strings. */
const sanitize = (value, depth = 0) => {
  if (depth > 3) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitize(item, depth + 1));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitize(item, depth + 1),
      ]),
    );
  }

  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}...`;
  }

  return value;
};

/** `key=value` pairs; values containing spaces are JSON-quoted for readability. */
const formatContext = (context = {}) =>
  Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const printable = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return /\s/.test(printable) ? `${key}=${JSON.stringify(printable)}` : `${key}=${printable}`;
    })
    .join(' ');

/** Core writer: `TIMESTAMP LEVEL message key=value ...`. */
const write = (level, message, context) => {
  if (!isEnabled(level)) return;

  const line = [new Date().toISOString(), colourise(level), message, formatContext(context)]
    .filter((part) => part !== '')
    .join(' ');

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

/** Action logger used across the app (startup, DB, seed, auth, errors). */
const logger = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
  /** Convenience for caught exceptions: message + first stack frame. */
  exception: (message, error, context = {}) =>
    write('error', message, {
      ...context,
      error: error?.message,
      at: error?.stack?.split('\n')[1]?.trim(),
    }),
  isEnabled,
};

// ---------------------------------------------------------------------------
// Request filter chain
// ---------------------------------------------------------------------------

const logRequestBody = () => String(process.env.LOG_REQUEST_BODY).toLowerCase() === 'true';

const clientIp = (req) => (req.ip ?? req.socket?.remoteAddress ?? '-').replace('::ffff:', '');

/**
 * Endpoint name from the requested path, with numeric ids collapsed to `:id`
 * (`/api/users/12` -> `/api/users/:id`). Express resets `req.route`/`req.baseUrl`
 * before the response finishes, so the URL is the reliable source here.
 */
const endpointOf = (req) => {
  const path = (req.originalUrl.split('?')[0] || '/').replace(/\/\d+(?=\/|$)/g, '/:id');

  return path.length > 1 ? path.replace(/\/$/, '') : path;
};

/** Status code decides the log level: 5xx error, 4xx warn, else info. */
const levelForStatus = (statusCode) => {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
};

/** Filter 1: give every request an id (also returned to the client). */
const attachRequestId = (req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  res.setHeader('x-request-id', req.id);
  next();
};

/** Filter 2: log the incoming request (`--> GET /api/users`). */
const logRequestStart = (req, res, next) => {
  logger.debug(`--> ${req.method} ${req.originalUrl}`, {
    req: req.id,
    ip: clientIp(req),
  });

  next();
};

/** Filter 3: log the response (`<-- GET /api/users status=200 ms=12.4`). */
const logRequestComplete = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = levelForStatus(res.statusCode);
    const context = {
      req: req.id,
      status: res.statusCode,
      ms: durationMs.toFixed(1),
      ip: clientIp(req),
      actor: req.actor ? (req.actor.userId ?? 'bootstrap') : undefined,
      company: req.actor ? (req.actor.companyId ?? 'all') : undefined,
    };

    // Body is parsed by the time the response finishes (sensitive keys redacted).
    if (logRequestBody() && req.body && Object.keys(req.body).length > 0) {
      context.body = sanitize(req.body);
    }

    logger[level](`<-- ${req.method} ${endpointOf(req)}`, context);
  });

  next();
};

/** The chain, executed in order by `runFilterChain`. */
const FILTER_CHAIN = [attachRequestId, logRequestStart, logRequestComplete];

/**
 * Runs the filters like a servlet filter chain: a filter calls `next()` to pass
 * control on, or `next(error)` to short-circuit straight into error handling.
 */
const runFilterChain = (filters, req, res, done) => {
  let index = 0;

  const step = (error) => {
    if (error) {
      done(error);
      return;
    }

    const filter = filters[index];
    index += 1;

    if (!filter) {
      done();
      return;
    }

    try {
      filter(req, res, step);
    } catch (filterError) {
      done(filterError);
    }
  };

  step();
};

/** Express middleware: executes the whole request logging filter chain. */
const requestLogger = (req, res, next) => {
  runFilterChain(FILTER_CHAIN, req, res, next);
};

module.exports = { FILTER_CHAIN, logger, requestLogger, sanitize };

