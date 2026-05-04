import React, { useState, useEffect, useCallback } from 'react';
import { fetchWorkItems, fetchHealth, ingestSignal } from '../api/client';

const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

export default function Dashboard({ onSelect }) {
  const [items, setItems] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = filter !== 'ALL' ? { status: filter } : {};
      const data = await fetchWorkItems(params);
      const sorted = (data.items || []).sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      );
      setItems(sorted);
      setError('');
    } catch {
      setError('Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadHealth = async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
    } catch { setHealth(null); }
  };

  useEffect(() => {
    load();
    loadHealth();
    const interval = setInterval(() => { load(); loadHealth(); }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function simulateRdbmsOutage() {
    setIngesting(true);
    // Send a burst simulating RDBMS_PRIMARY failure
    const signals = Array.from({ length: 5 }, (_, i) => ({
      componentId: 'RDBMS_PRIMARY',
      componentType: 'RDBMS',
      errorType: 'CONNECTION_TIMEOUT',
      severity: 'P0',
      message: `Primary DB unreachable — attempt ${i + 1}`,
      payload: { host: 'db-primary.internal', port: 5432 },
    }));

    try {
      await Promise.all(signals.map((s) => ingestSignal(s)));
      setTimeout(load, 1500);
    } catch {
      setError('Failed to simulate outage');
    } finally {
      setIngesting(false);
    }
  }

  const statuses = ['ALL', 'OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'];

  return (
    <div>
      {/* Health bar */}
      {health && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <MetricCard label="MongoDB" value={health.services?.mongodb} type="service" />
          <MetricCard label="Redis" value={health.services?.redis} type="service" />
          <MetricCard label="Signals/sec" value={health.metrics?.signalsPerSecond ?? '—'} />
          <MetricCard label="Queue depth" value={health.metrics?.queueDepth ?? '—'} />
          <MetricCard label="Total ingested" value={health.metrics?.totalProcessed ?? '—'} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>
          Active incidents
          <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--muted)' }}>({items.length})</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 3 }}>
            {statuses.map((s) => (
              <button
                key={s}
                className="btn"
                style={{ padding: '4px 10px', fontSize: 12, background: filter === s ? 'var(--surface2)' : 'transparent', border: 'none', color: filter === s ? 'var(--text)' : 'var(--muted)' }}
                onClick={() => setFilter(s)}
              >{s}</button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={simulateRdbmsOutage} disabled={ingesting}>
            {ingesting ? 'Sending…' : '🔥 Simulate outage'}
          </button>
        </div>
      </div>

      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>✅</p>
          <p>No incidents. System is healthy.</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>Click "Simulate outage" to test the system.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <IncidentRow key={item.workItemId} item={item} onClick={() => onSelect(item.workItemId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentRow({ item, onClick }) {
  const ago = timeAgo(item.createdAt);
  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${sevColor(item.severity)}` }}
    >
      <span className={`badge badge-${item.severity}`}>{item.severity}</span>
      <div style={{ flex: 1 }}>
        <p style={{ fontWeight: 500 }}>{item.componentId}</p>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>{item.componentType} · {item.signalCount} signal{item.signalCount !== 1 ? 's' : ''}</p>
      </div>
      <span className={`status status-${item.status}`}>{item.status}</span>
      <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 60, textAlign: 'right' }}>{ago}</span>
      <span style={{ color: 'var(--muted)', fontSize: 16 }}>›</span>
    </div>
  );
}

function MetricCard({ label, value, type }) {
  const isService = type === 'service';
  const isUp = value === 'up';
  return (
    <div className="card" style={{ padding: '8px 14px', minWidth: 100 }}>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</p>
      <p style={{ fontWeight: 600, fontSize: 15, color: isService ? (isUp ? 'var(--p3)' : 'var(--p0)') : 'var(--text)' }}>
        {isService ? (isUp ? '● up' : '● down') : value}
      </p>
    </div>
  );
}

function sevColor(s) {
  return { P0: '#ef4444', P1: '#f97316', P2: '#eab308', P3: '#22c55e' }[s] || '#6366f1';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
