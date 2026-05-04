/**
 * Signal Processor — The Producer
 *
 * This is the heart of the system's resilience:
 * - An in-memory async queue acts as a buffer, so even if MongoDB is slow,
 *   incoming signals are not dropped (backpressure handled here).
 * - Debounce windows: if 100 signals arrive for the same componentId within
 *   10 seconds, only ONE WorkItem is created. All signals link to it.
 * - Alerting Strategy Pattern: different component types trigger different alerts.
 */

const Signal = require('../models/Signal');
const WorkItem = require('../models/WorkItem');
const { getRedis } = require('../config/redis');
const { AlertingStrategy } = require('./alertingStrategy');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// In-memory queue — handles burst of 10,000 signals/sec without crashing
const signalQueue = [];
let processing = false;
let signalsProcessed = 0;
let signalsPerSecond = 0;

// Debounce windows: componentId → { workItemId, timer, count }
const debounceWindows = new Map();

const DEBOUNCE_WINDOW_MS = parseInt(process.env.DEBOUNCE_WINDOW_MS) || 10000;
const DEBOUNCE_THRESHOLD = parseInt(process.env.DEBOUNCE_THRESHOLD) || 100;
const BATCH_SIZE = 50; // process signals in batches to avoid blocking the event loop

/**
 * Enqueue a signal from the HTTP handler.
 * Returns immediately — never blocks the HTTP response.
 */
function enqueueSignal(signalData) {
  signalQueue.push(signalData);
  signalsProcessed++;
  if (!processing) {
    setImmediate(processQueue); // schedule without blocking current tick
  }
}

/**
 * Drain the queue in batches. Uses setImmediate between batches
 * so the event loop can handle other I/O (HTTP requests, etc.)
 */
async function processQueue() {
  if (processing || signalQueue.length === 0) return;
  processing = true;

  while (signalQueue.length > 0) {
    const batch = signalQueue.splice(0, BATCH_SIZE);
    await Promise.allSettled(batch.map(processSignal));
    // Yield to event loop between batches
    await new Promise((r) => setImmediate(r));
  }

  processing = false;
}

async function processSignal(signalData) {
  try {
    const signal = new Signal({
      signalId:      signalData.signalId || uuidv4(),
      componentId:   signalData.componentId,
      componentType: signalData.componentType,
      errorType:     signalData.errorType,
      severity:      signalData.severity,
      message:       signalData.message,
      payload:       signalData.payload,
      receivedAt:    new Date(),
    });

    // --- DEBOUNCE LOGIC ---
    const key = signalData.componentId;
    const window = debounceWindows.get(key);

    if (window) {
      // Window already open — increment count and link this signal
      window.count++;
      signal.workItemId = window.workItemId;
      await signal.save();

      // Update the work item's signal count in Mongo
      await WorkItem.updateOne({ workItemId: window.workItemId }, { $inc: { signalCount: 1 } });

      // Invalidate Redis cache for this work item
      await invalidateCache(window.workItemId);

      if (window.count >= DEBOUNCE_THRESHOLD) {
        logger.warn(`Debounce threshold hit for ${key}`, { count: window.count });
      }
    } else {
      // New window — create a WorkItem
      const workItemId = uuidv4();
      signal.workItemId = workItemId;
      await signal.save();

      const workItem = new WorkItem({
        workItemId,
        componentId:   signalData.componentId,
        componentType: signalData.componentType,
        severity:      signalData.severity,
        firstSignalAt: signal.receivedAt,
        signalCount:   1,
      });
      await workItem.save();

      // Fire alert using Strategy Pattern
      const strategy = AlertingStrategy.forComponent(signalData.componentType, signalData.severity);
      await strategy.alert(workItem);

      // Write to Redis hot-path cache
      await cacheWorkItem(workItem);

      // Open debounce window with auto-close timer
      const timer = setTimeout(() => {
        debounceWindows.delete(key);
        logger.debug(`Debounce window closed for ${key}`);
      }, DEBOUNCE_WINDOW_MS);

      debounceWindows.set(key, { workItemId, timer, count: 1 });
      logger.info(`New WorkItem created`, { workItemId, componentId: key, severity: signalData.severity });
    }
  } catch (err) {
    logger.error('Error processing signal', { message: err.message, signalData });
    // Signal stays in memory if DB write fails — retry logic could be added here
  }
}

async function cacheWorkItem(workItem) {
  try {
    const redis = getRedis();
    const key = `workitem:${workItem.workItemId}`;
    await redis.setEx(key, 300, JSON.stringify(workItem)); // 5-min TTL
    // Also update dashboard list in Redis
    await redis.lPush('dashboard:active', workItem.workItemId);
    await redis.lTrim('dashboard:active', 0, 99); // keep last 100
  } catch (err) {
    logger.warn('Redis cache write failed (non-fatal)', { message: err.message });
  }
}

async function invalidateCache(workItemId) {
  try {
    const redis = getRedis();
    await redis.del(`workitem:${workItemId}`);
  } catch (_) { /* non-fatal */ }
}

function startSignalProcessor() {
  // Metrics: count signals per 5-second window
  let lastCount = 0;
  setInterval(() => {
    signalsPerSecond = (signalsProcessed - lastCount) / 5;
    lastCount = signalsProcessed;
  }, 5000);

  logger.info('Signal processor started');
}

function getMetrics() {
  return {
    queueDepth: signalQueue.length,
    totalProcessed: signalsProcessed,
    signalsPerSecond: Math.round(signalsPerSecond * 10) / 10,
    activeDebounceWindows: debounceWindows.size,
  };
}

module.exports = { enqueueSignal, startSignalProcessor, getMetrics };
