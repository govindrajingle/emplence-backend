'use strict';

const express = require('express');

const routes = require('./routes');
const { logger, requestLogger } = require('./middleware/requestLogger');

// The app only wires middleware and routes together, so it can be started
// (or exercised) independently from the process/server bootstrap.
const app = express();

// Logging filter chain first: every request (404s and failures included) is logged.
app.use(requestLogger);

app.use(express.json());

// All application routes are mounted from the routes layer (routes -> controllers -> models).
app.use('/', routes);

// 404 handler: unknown routes never fall through to Express' default HTML page.
app.use((req, res) => {
  res.status(404).json({
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

/**
 * Central error handler. Controllers can delegate failures with `next(error)`;
 * only a safe message is exposed to the client while details stay in the logs.
 */
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const context = {
    req: req.id,
    status: statusCode,
    method: req.method,
    endpoint: req.originalUrl,
  };

  if (statusCode >= 500) {
    logger.exception(`${req.method} ${req.originalUrl} failed`, error, context);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} rejected: ${error.message}`, context);
  }

  res.status(statusCode).json({
    message: statusCode === 500 ? 'Internal server error.' : error.message,
  });
});

module.exports = app;
