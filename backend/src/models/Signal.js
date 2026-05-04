const mongoose = require('mongoose');

// Raw signals are the "data lake" — every signal ever received, linked to a work item
const signalSchema = new mongoose.Schema({
  signalId:    { type: String, required: true, unique: true },
  componentId: { type: String, required: true, index: true },
  componentType: {
    type: String,
    enum: ['API', 'CACHE', 'RDBMS', 'QUEUE', 'NOSQL', 'MCP_HOST'],
    required: true,
  },
  errorType:   { type: String, required: true },
  severity:    { type: String, enum: ['P0', 'P1', 'P2', 'P3'], required: true },
  message:     { type: String },
  payload:     { type: mongoose.Schema.Types.Mixed }, // arbitrary JSON
  workItemId:  { type: String, index: true },         // linked after debounce
  receivedAt:  { type: Date, default: Date.now, index: true },
}, { collection: 'signals' });

module.exports = mongoose.model('Signal', signalSchema);
