'use strict';

/**
 * Error helpers shared by the model layer.
 *
 * `createAppError` attaches an HTTP status code so the central error handler in
 * `src/app.js` can return the message to the client instead of a generic 500.
 * `mapDatabaseError` translates PostgreSQL constraint violations into those
 * errors, keeping SQL details out of API responses.
 */

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

const createAppError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/**
 * @param {Error & { code?: string }} error raw driver error
 * @param {{ unique?: string, foreignKey?: string, check?: string }} messages
 */
const mapDatabaseError = (error, messages = {}) => {
  switch (error.code) {
    case PG_UNIQUE_VIOLATION:
      return createAppError(409, messages.unique || 'A record with the same unique value already exists.');
    case PG_FOREIGN_KEY_VIOLATION:
      return createAppError(400, messages.foreignKey || 'Referenced record does not exist.');
    case PG_CHECK_VIOLATION:
      return createAppError(400, messages.check || 'Value violates a database constraint.');
    default:
      return error;
  }
};

module.exports = { createAppError, mapDatabaseError };
