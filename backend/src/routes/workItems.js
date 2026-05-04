const express = require('express');
const router = express.Router();
const WorkItem = require('../models/WorkItem');
const { getRedis } = require('../config/redis');
const { validate, rcaSchema } = require('../middleware/validate');
const logger = require('../utils/logger');

// GET /api/work-items — list all (with Redis cache for dashboard)
router.get('/', async (req, res) => {
  try {
    const { status, severity, limit = 50 } = req.query;

    // Try Redis hot-path first for full unfiltered list
    if (!status && !severity) {
      try {
        const redis = getRedis();
        const ids = await redis.lRange('dashboard:active', 0, parseInt(limit) - 1);
        if (ids.length > 0) {
          const cached = await Promise.all(ids.map((id) => redis.get(`workitem:${id}`)));
          const items = cached.filter(Boolean).map((s) => JSON.parse(s));
          if (items.length > 0) return res.json({ source: 'cache', items });
        }
      } catch (_) { /* fall through to DB */ }
    }

    // Fall through to MongoDB
    const filter = {};
    if (status) filter.status = status;
    if (severity) filter.severity = severity;

    const items = await WorkItem.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ source: 'db', items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/work-items/:id — single work item
router.get('/:id', async (req, res) => {
  try {
    // Check Redis first
    try {
      const redis = getRedis();
      const cached = await redis.get(`workitem:${req.params.id}`);
      if (cached) return res.json({ source: 'cache', item: JSON.parse(cached) });
    } catch (_) {}

    const item = await WorkItem.findOne({ workItemId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Work item not found' });
    res.json({ source: 'db', item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/work-items/:id/status — advance state machine
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const item = await WorkItem.findOne({ workItemId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Work item not found' });

    const validNext = WorkItem.TRANSITIONS[item.status] || [];
    if (!validNext.includes(status)) {
      return res.status(422).json({
        error: `Cannot transition from ${item.status} to ${status}`,
        validTransitions: validNext,
      });
    }

    item.status = status;
    await item.save(); // pre-save hooks enforce RCA check for CLOSED

    // Invalidate Redis cache
    try {
      const redis = getRedis();
      await redis.del(`workitem:${item.workItemId}`);
      await redis.setEx(`workitem:${item.workItemId}`, 300, JSON.stringify(item));
    } catch (_) {}

    logger.info('WorkItem status updated', { workItemId: item.workItemId, status });
    res.json({ item });
  } catch (err) {
    // State machine or RCA validation errors come here
    res.status(422).json({ error: err.message });
  }
});

// POST /api/work-items/:id/rca — submit RCA
router.post('/:id/rca', validate(rcaSchema), async (req, res) => {
  try {
    const item = await WorkItem.findOne({ workItemId: req.params.id });
    if (!item) return res.status(404).json({ error: 'Work item not found' });

    if (item.status === 'CLOSED') {
      return res.status(409).json({ error: 'Incident is already closed' });
    }

    // Calculate MTTR
    const start = new Date(req.body.incidentStart);
    const end = new Date(req.body.incidentEnd);
    const mttr = Math.round((end - start) / 60000);

    item.rca = { ...req.body, mttr };
    await item.save();

    // Invalidate cache
    try {
      const redis = getRedis();
      await redis.del(`workitem:${item.workItemId}`);
    } catch (_) {}

    res.json({ message: 'RCA saved', item });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

module.exports = router;
