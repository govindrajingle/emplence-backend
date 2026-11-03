'use strict';

/**
 * Controller layer: turns HTTP requests into responses.
 * Networking/DTO concerns live here; database access belongs to the model layer
 * and must never be called directly from a route.
 */

/**
 * GET /hello
 * Confirms that the backend process is running and serving requests.
 */
const getHello = (req, res) => {
  res.status(200).json({
    message: 'Hello! Backend is running successfully.',
  });
};

module.exports = { getHello };
