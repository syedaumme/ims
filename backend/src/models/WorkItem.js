const mongoose = require('mongoose');

// Valid state transitions — State Pattern enforced at model level
const TRANSITIONS = {
  OPEN:          ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED:      ['CLOSED'],
  CLOSED:        [],
};

const rcaSchema = new mongoose.Schema({
  incidentStart:     { type: Date, required: true },
  incidentEnd:       { type: Date, required: true },
  rootCauseCategory: {
    type: String,
    enum: ['INFRA_FAILURE', 'CODE_BUG', 'CONFIG_ERROR', 'CAPACITY', 'THIRD_PARTY', 'UNKNOWN'],
    required: true,
  },
  fixApplied:        { type: String, required: true, minlength: 10 },
  preventionSteps:   { type: String, required: true, minlength: 10 },
  mttr:              { type: Number }, // minutes — auto-calculated
}, { _id: false });

const workItemSchema = new mongoose.Schema({
  workItemId:   { type: String, required: true, unique: true, index: true },
  componentId:  { type: String, required: true, index: true },
  componentType:{ type: String, required: true },
  severity:     { type: String, enum: ['P0', 'P1', 'P2', 'P3'], required: true },
  status:       {
    type: String,
    enum: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'],
    default: 'OPEN',
    index: true,
  },
  signalCount:  { type: Number, default: 1 },
  firstSignalAt:{ type: Date, required: true },
  rca:          { type: rcaSchema, default: null },
  alertSent:    { type: Boolean, default: false },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
}, { collection: 'work_items' });

// State machine validation before save
workItemSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    const original = this._previousStatus;
    if (original && !TRANSITIONS[original]?.includes(this.status)) {
      return next(new Error(`Invalid transition: ${original} → ${this.status}`));
    }
  }
  this.updatedAt = new Date();
  next();
});

// Track previous status for transition validation
workItemSchema.post('init', function () {
  this._previousStatus = this.status;
});

// Validate RCA when closing
workItemSchema.pre('save', function (next) {
  if (this.status === 'CLOSED') {
    const r = this.rca;
    if (!r || !r.rootCauseCategory || !r.fixApplied || !r.preventionSteps) {
      return next(new Error('RCA must be complete before closing an incident'));
    }
    // Auto-calculate MTTR in minutes
    if (r.incidentStart && r.incidentEnd) {
      r.mttr = Math.round((new Date(r.incidentEnd) - new Date(r.incidentStart)) / 60000);
    }
  }
  next();
});

workItemSchema.statics.TRANSITIONS = TRANSITIONS;

module.exports = mongoose.model('WorkItem', workItemSchema);
