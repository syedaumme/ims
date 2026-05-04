import React, { useState, useEffect } from 'react';
import { fetchWorkItem, fetchSignals, updateStatus, submitRca } from '../api/client';

const NEXT_STATUS = {
  OPEN: 'INVESTIGATING',
  INVESTIGATING: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};

const ROOT_CAUSE_OPTIONS = [
  'INFRA_FAILURE', 'CODE_BUG', 'CONFIG_ERROR', 'CAPACITY', 'THIRD_PARTY', 'UNKNOWN',
];

export default function IncidentDetail({ id, onBack }) {
  const [item, setItem] = useState(null);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [showRca, setShowRca] = useState(false);
  const [rcaError, setRcaError] = useState('');
  const [rcaSuccess, setRcaSuccess] = useState(false);
  const [statusError, setStatusError] = useState('');

  const [rca, setRca] = useState({
    incidentStart: '',
    incidentEnd: '',
    rootCauseCategory: 'INFRA_FAILURE',
    fixApplied: '',
    preventionSteps: '',
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [itemData, sigData] = await Promise.all([
          fetchWorkItem(id),
          fetchSignals(id),
        ]);
        setItem(itemData.item);
        setSignals(sigData);
        // Pre-fill start time from first signal
        if (itemData.item?.firstSignalAt) {
          setRca((r) => ({ ...r, incidentStart: new Date(itemData.item.firstSignalAt).toISOString().slice(0, 16) }));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function advanceStatus() {
    const next = NEXT_STATUS[item.status];
    if (!next) return;

    // Must have RCA before closing
    if (next === 'CLOSED' && !item.rca) {
      setShowRca(true);
      setStatusError('You must submit an RCA before closing this incident.');
      return;
    }

    setTransitioning(true);
    setStatusError('');
    try {
      const data = await updateStatus(id, next);
      setItem(data.item);
    } catch (err) {
      setStatusError(err.response?.data?.error || 'Failed to update status');
    } finally {
      setTransitioning(false);
    }
  }

  async function handleRcaSubmit(e) {
    e.preventDefault();
    setRcaError('');
    try {
      const data = await submitRca(id, {
        ...rca,
        incidentStart: new Date(rca.incidentStart).toISOString(),
        incidentEnd:   new Date(rca.incidentEnd).toISOString(),
      });
      setItem(data.item);
      setRcaSuccess(true);
      setShowRca(false);
    } catch (err) {
      setRcaError(err.response?.data?.error || (err.response?.data?.details || []).join(', ') || 'Failed to save RCA');
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <div className="spinner" />
    </div>
  );

  if (!item) return (
    <div>
      <button className="btn btn-ghost" onClick={onBack}>← Back</button>
      <p style={{ marginTop: 20, color: 'var(--muted)' }}>Incident not found.</p>
    </div>
  );

  const nextStatus = NEXT_STATUS[item.status];
  const mttr = item.rca?.mttr;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <span className={`badge badge-${item.severity}`}>{item.severity}</span>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{item.componentId}</h2>
        <span className={`status status-${item.status}`}>{item.status}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <InfoCard title="Component type" value={item.componentType} />
        <InfoCard title="Signal count" value={item.signalCount} />
        <InfoCard title="First seen" value={new Date(item.firstSignalAt).toLocaleString()} />
        <InfoCard title="MTTR" value={mttr != null ? `${mttr} minutes` : '—'} />
      </div>

      {/* Status controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 600, marginBottom: 12 }}>Workflow</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'].map((s, i) => (
            <React.Fragment key={s}>
              <span style={{
                padding: '4px 12px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                background: item.status === s ? 'var(--blue)' : 'var(--surface2)',
                color: item.status === s ? 'white' : 'var(--muted)',
              }}>{s}</span>
              {i < 3 && <span style={{ color: 'var(--muted)' }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        {nextStatus && (
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={advanceStatus} disabled={transitioning}>
              {transitioning ? 'Updating…' : `Move to ${nextStatus}`}
            </button>
            {nextStatus === 'CLOSED' && !item.rca && (
              <button className="btn" style={{ marginLeft: 8 }} onClick={() => setShowRca(true)}>
                📝 Fill RCA first
              </button>
            )}
          </div>
        )}
        {statusError && <p className="error-msg" style={{ marginTop: 8 }}>{statusError}</p>}
        {rcaSuccess && <p style={{ marginTop: 8, color: 'var(--p3)', fontSize: 13 }}>✓ RCA saved successfully</p>}
      </div>

      {/* RCA form */}
      {(showRca || item.rca) && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p style={{ fontWeight: 600, marginBottom: 16 }}>
            {item.rca ? '📋 Root Cause Analysis' : '📝 Submit Root Cause Analysis'}
          </p>
          {item.rca ? (
            <RcaView rca={item.rca} />
          ) : (
            <RcaForm rca={rca} setRca={setRca} onSubmit={handleRcaSubmit} error={rcaError} />
          )}
        </div>
      )}
      {!showRca && !item.rca && item.status !== 'CLOSED' && (
        <div style={{ marginBottom: 20 }}>
          <button className="btn" onClick={() => setShowRca(true)}>📝 Submit RCA</button>
        </div>
      )}

      {/* Signals table */}
      <div className="card">
        <p style={{ fontWeight: 600, marginBottom: 12 }}>Raw signals ({signals.length})</p>
        {signals.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No signals linked yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Error type', 'Severity', 'Message'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.signalId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{new Date(s.receivedAt).toLocaleTimeString()}</td>
                    <td style={{ padding: '6px 8px' }}>{s.errorType}</td>
                    <td style={{ padding: '6px 8px' }}><span className={`badge badge-${s.severity}`}>{s.severity}</span></td>
                    <td style={{ padding: '6px 8px', color: 'var(--muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ title, value }) {
  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{title}</p>
      <p style={{ fontWeight: 500 }}>{value}</p>
    </div>
  );
}

function RcaForm({ rca, setRca, onSubmit, error }) {
  const set = (k) => (e) => setRca((r) => ({ ...r, [k]: e.target.value }));
  return (
    <form onSubmit={onSubmit}>
      <div className="grid-2">
        <div className="form-group">
          <label>Incident start *</label>
          <input type="datetime-local" value={rca.incidentStart} onChange={set('incidentStart')} required />
        </div>
        <div className="form-group">
          <label>Incident end *</label>
          <input type="datetime-local" value={rca.incidentEnd} onChange={set('incidentEnd')} required />
        </div>
      </div>
      <div className="form-group">
        <label>Root cause category *</label>
        <select value={rca.rootCauseCategory} onChange={set('rootCauseCategory')}>
          {['INFRA_FAILURE', 'CODE_BUG', 'CONFIG_ERROR', 'CAPACITY', 'THIRD_PARTY', 'UNKNOWN'].map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Fix applied * (min 10 chars)</label>
        <textarea value={rca.fixApplied} onChange={set('fixApplied')} required minLength={10} placeholder="Describe the fix that was applied..." />
      </div>
      <div className="form-group">
        <label>Prevention steps * (min 10 chars)</label>
        <textarea value={rca.preventionSteps} onChange={set('preventionSteps')} required minLength={10} placeholder="How will this be prevented in future?" />
      </div>
      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}
      <button type="submit" className="btn btn-primary">Save RCA</button>
    </form>
  );
}

function RcaView({ rca }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="grid-2">
        <Field label="Incident start" value={new Date(rca.incidentStart).toLocaleString()} />
        <Field label="Incident end" value={new Date(rca.incidentEnd).toLocaleString()} />
        <Field label="MTTR" value={`${rca.mttr} minutes`} />
        <Field label="Root cause" value={rca.rootCauseCategory} />
      </div>
      <Field label="Fix applied" value={rca.fixApplied} />
      <Field label="Prevention steps" value={rca.preventionSteps} />
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 13 }}>{value}</p>
    </div>
  );
}
