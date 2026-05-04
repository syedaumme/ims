import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import IncidentDetail from './pages/IncidentDetail';
import './App.css';

export default function App() {
  const [selectedId, setSelectedId] = useState(null);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo">⚡ IMS</span>
          <span className="header-title">Incident Management System</span>
        </div>
        <a
          className="health-link"
          href="/health"
          target="_blank"
          rel="noreferrer"
        >
          /health
        </a>
      </header>

      <main className="app-main">
        {selectedId ? (
          <IncidentDetail id={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <Dashboard onSelect={setSelectedId} />
        )}
      </main>
    </div>
  );
}
