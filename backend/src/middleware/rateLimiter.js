const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  message: { error: 'Too many requests — rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { rateLimiter };
