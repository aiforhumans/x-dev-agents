/**
 * Shared Express JSON error middleware.
 */
function createErrorHandler({ logger }) {
  return (error, req, res, next) => {
    const status = Number(error.status) || 500;
    const message = error.message || "Internal server error.";
    if (status >= 500) {
      logger.error(error?.stack || message, { req });
    }
    res.status(status).json({ error: message });
  };
}

module.exports = {
  createErrorHandler
};
