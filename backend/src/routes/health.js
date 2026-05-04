const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getRedis } = require('../config/redis');
const { getMetrics } = require('../services/signalProcessor');

router.get('/', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;

  let redisOk = false;
  try {
    const redis = getRedis();
    await redis.ping();
    redisOk = true;
  } catch (_) {}

  const metrics = getMetrics();
  const healthy = mongoOk && redisOk;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
    },
    metrics,
  });
});

module.exports = router;
