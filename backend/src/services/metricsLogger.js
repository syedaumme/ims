const { getMetrics } = require('./signalProcessor');
const logger = require('../utils/logger');

function startMetricsLogger() {
  const interval = parseInt(process.env.METRICS_INTERVAL_MS) || 5000;
  setInterval(() => {
    const m = getMetrics();
    logger.info('THROUGHPUT_METRICS', {
      signalsPerSecond: m.signalsPerSecond,
      queueDepth: m.queueDepth,
      totalProcessed: m.totalProcessed,
      activeDebounceWindows: m.activeDebounceWindows,
    });
  }, interval);
}

module.exports = { startMetricsLogger };
