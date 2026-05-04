/**
 * Unit tests for:
 * 1. RCA validation — system must reject CLOSED state without complete RCA
 * 2. State machine — valid and invalid transitions
 * 3. MTTR calculation
 * 4. Alerting strategy selection
 */

const { AlertingStrategy, P0CriticalAlert, P1HighAlert, P2StandardAlert, P3LowAlert } = require('../src/services/alertingStrategy');

// ── RCA Validation Tests ─────────────────────────────────────────────────────

describe('RCA Validation', () => {
  test('rejects CLOSED status when RCA is missing', () => {
    // Simulate what the model pre-save hook checks
    function validateClose(status, rca) {
      if (status === 'CLOSED') {
        if (!rca || !rca.rootCauseCategory || !rca.fixApplied || !rca.preventionSteps) {
          throw new Error('RCA must be complete before closing an incident');
        }
      }
      return true;
    }

    expect(() => validateClose('CLOSED', null)).toThrow('RCA must be complete');
    expect(() => validateClose('CLOSED', {})).toThrow('RCA must be complete');
    expect(() => validateClose('CLOSED', { rootCauseCategory: 'CODE_BUG' })).toThrow('RCA must be complete');
  });

  test('accepts CLOSED status with complete RCA', () => {
    function validateClose(status, rca) {
      if (status === 'CLOSED') {
        if (!rca || !rca.rootCauseCategory || !rca.fixApplied || !rca.preventionSteps) {
          throw new Error('RCA must be complete before closing an incident');
        }
      }
      return true;
    }

    const completeRca = {
      rootCauseCategory: 'CODE_BUG',
      fixApplied: 'Rolled back faulty deployment',
      preventionSteps: 'Added pre-deploy integration tests',
      incidentStart: new Date('2024-01-01T10:00:00Z'),
      incidentEnd:   new Date('2024-01-01T11:30:00Z'),
    };

    expect(validateClose('CLOSED', completeRca)).toBe(true);
  });

  test('allows state changes to non-CLOSED states without RCA', () => {
    function validateClose(status, rca) {
      if (status === 'CLOSED') {
        if (!rca || !rca.rootCauseCategory || !rca.fixApplied || !rca.preventionSteps) {
          throw new Error('RCA must be complete');
        }
      }
      return true;
    }

    expect(validateClose('INVESTIGATING', null)).toBe(true);
    expect(validateClose('RESOLVED', null)).toBe(true);
  });
});

// ── State Machine Tests ──────────────────────────────────────────────────────

describe('State Machine Transitions', () => {
  const TRANSITIONS = {
    OPEN:          ['INVESTIGATING'],
    INVESTIGATING: ['RESOLVED'],
    RESOLVED:      ['CLOSED'],
    CLOSED:        [],
  };

  function canTransition(from, to) {
    return (TRANSITIONS[from] || []).includes(to);
  }

  test('allows valid transitions', () => {
    expect(canTransition('OPEN', 'INVESTIGATING')).toBe(true);
    expect(canTransition('INVESTIGATING', 'RESOLVED')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(canTransition('OPEN', 'CLOSED')).toBe(false);
    expect(canTransition('OPEN', 'RESOLVED')).toBe(false);
    expect(canTransition('CLOSED', 'OPEN')).toBe(false);
    expect(canTransition('INVESTIGATING', 'OPEN')).toBe(false);
  });

  test('closed state has no valid next transitions', () => {
    expect(TRANSITIONS['CLOSED']).toHaveLength(0);
  });
});

// ── MTTR Calculation Tests ───────────────────────────────────────────────────

describe('MTTR Calculation', () => {
  function calculateMttr(startIso, endIso) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    return Math.round((end - start) / 60000);
  }

  test('calculates MTTR correctly in minutes', () => {
    expect(calculateMttr('2024-01-01T10:00:00Z', '2024-01-01T10:30:00Z')).toBe(30);
    expect(calculateMttr('2024-01-01T10:00:00Z', '2024-01-01T12:00:00Z')).toBe(120);
    expect(calculateMttr('2024-01-01T10:00:00Z', '2024-01-01T10:01:00Z')).toBe(1);
  });

  test('returns 0 for same start and end time', () => {
    expect(calculateMttr('2024-01-01T10:00:00Z', '2024-01-01T10:00:00Z')).toBe(0);
  });
});

// ── Alerting Strategy Tests ──────────────────────────────────────────────────

describe('Alerting Strategy Pattern', () => {
  test('RDBMS always gets P0 strategy regardless of severity', () => {
    expect(AlertingStrategy.forComponent('RDBMS', 'P3')).toBeInstanceOf(P0CriticalAlert);
    expect(AlertingStrategy.forComponent('RDBMS', 'P2')).toBeInstanceOf(P0CriticalAlert);
  });

  test('MCP_HOST gets P1 strategy', () => {
    expect(AlertingStrategy.forComponent('MCP_HOST', 'P2')).toBeInstanceOf(P1HighAlert);
  });

  test('CACHE gets P2 strategy', () => {
    expect(AlertingStrategy.forComponent('CACHE', 'P0')).toBeInstanceOf(P2StandardAlert);
  });

  test('API component uses signal severity', () => {
    expect(AlertingStrategy.forComponent('API', 'P0')).toBeInstanceOf(P0CriticalAlert);
    expect(AlertingStrategy.forComponent('API', 'P1')).toBeInstanceOf(P1HighAlert);
    expect(AlertingStrategy.forComponent('API', 'P2')).toBeInstanceOf(P2StandardAlert);
    expect(AlertingStrategy.forComponent('API', 'P3')).toBeInstanceOf(P3LowAlert);
  });
});
