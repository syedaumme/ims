const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { enqueueSignal } = require('../services/signalProcessor');
const Signal = require('../models/Signal');
const { validate, signalSchema } = require('../middleware/validate');

// POST /api/signals — ingest a single signal
// Returns immediately; actual processing is async (non-blocking)
router.post('/', validate(signalSchema), (req, res) => {
  const signal = { ...req.body, signalId: uuidv4() };
  enqueueSignal(signal);
  res.status(202).json({ message: 'Signal accepted', signalId: signal.signalId });
});

// POST /api/signals/batch — ingest multiple signals at once
router.post('/batch', (req, res) => {
  const signals = req.body;
  if (!Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ error: 'Body must be a non-empty array of signals' });
  }
  signals.forEach((s) => enqueueSignal({ ...s, signalId: uuidv4() }));
  res.status(202).json({ message: 'Batch accepted', count: signals.length });
});

// GET /api/signals?workItemId=xxx — fetch all signals linked to a work item
router.get('/', async (req, res) => {
  try {
    const { workItemId, componentId, limit = 50 } = req.query;
    const filter = {};
    if (workItemId) filter.workItemId = workItemId;
    if (componentId) filter.componentId = componentId;

    const signals = await Signal.find(filter)
      .sort({ receivedAt: -1 })
      .limit(parseInt(limit));

    res.json(signals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
