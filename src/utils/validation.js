'use strict';

const { createAppError } = require('./errors');

/** Small, reusable input validators shared by the models and controllers. */

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Positive integer id (accepts numeric strings, as they arrive from route params). */
const parseId = (value, field = 'id') => {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createAppError(400, `${field} must be a positive integer.`);
  }

  return id;
};

/** Required, trimmed, length-limited text. */
const parseRequiredText = (value, field, maxLength) => {
  const text = typeof value === 'string' ? value.trim() : '';

  if (!text) {
    throw createAppError(400, `${field} is required.`);
  }
  if (text.length > maxLength) {
    throw createAppError(400, `${field} must be at most ${maxLength} characters.`);
  }

  return text;
};

/** Boolean from a JSON boolean, or from "true"/"false"/1/0 when sent as a query parameter. */
const parseBoolean = (value, field) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;

  throw createAppError(400, `${field} must be a boolean.`);
};

/** Query-string boolean with a default, so `?includeInvalid` is optional. */
const parseOptionalBoolean = (value, field, fallback = false) =>
  value === undefined ? fallback : parseBoolean(value, field);

module.exports = { hasOwn, parseId, parseRequiredText, parseBoolean, parseOptionalBoolean };
