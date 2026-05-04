require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { connectMongo } = require('./config/db');
const { connectRedis } = require('./config/redis');
const signalRoutes = require('./routes/signals');
const workItemRoutes = require('./routes/workItems');
const healthRoutes = require('./routes/health');
const { rateLimiter } = require('./middleware/rateLimiter');
const { startSignalProcessor } = require('./services/signalProcessor');
const { startMetricsLogger } = require('./services/metricsLogger');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 4000;

// Security + parsing
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Rate limiter on ingestion path only
app.use('/api/signals', rateLimiter);

// Routes
app.use('/api/signals', signalRoutes);
app.use('/api/work-items', workItemRoutes);
app.use('/health', healthRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function bootstrap() {
  try {
    await connectMongo();
    await connectRedis();
    startSignalProcessor();
    startMetricsLogger();
    app.listen(PORT, () => {
      logger.info(`IMS backend running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { message: err.message });
    process.exit(1);
  }
}

bootstrap();
module.exports = app;
