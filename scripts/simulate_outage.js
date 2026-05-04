#!/usr/bin/env node
/**
 * simulate_outage.js
 *
 * Simulates a cascading failure:
 * 1. RDBMS_PRIMARY goes down (P0) — triggers 120 signals over 12 seconds
 *    → Only 1 WorkItem created (debounce). All 120 linked.
 * 2. MCP_HOST_01 fails (P1) — secondary failure 5 seconds later
 *
 * Run: node scripts/simulate_outage.js [API_URL]
 */

const API_URL = process.argv[2] || 'http://localhost:4000/api';

async function post(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('🔥 Starting cascade failure simulation...\n');

  // Phase 1: RDBMS outage — send 120 signals rapidly
  console.log('Phase 1: RDBMS_PRIMARY down — sending 120 P0 signals...');
  const rdbmsSignals = Array.from({ length: 120 }, (_, i) => ({
    componentId: 'RDBMS_PRIMARY',
    componentType: 'RDBMS',
    errorType: i < 10 ? 'CONNECTION_TIMEOUT' : i < 60 ? 'QUERY_FAILURE' : 'REPLICATION_LAG',
    severity: 'P0',
    message: `DB unreachable — attempt ${i + 1}`,
    payload: {
      host: 'db-primary.internal',
      port: 5432,
      latencyMs: 5000 + i * 10,
    },
  }));

  // Send in bursts to simulate high throughput
  for (let i = 0; i < rdbmsSignals.length; i += 10) {
    const batch = rdbmsSignals.slice(i, i + 10);
    await Promise.all(batch.map((s) => post('/signals', s)));
    process.stdout.write(`.`);
    await sleep(100);
  }
  console.log('\n✓ 120 RDBMS signals sent — only 1 WorkItem should be created (debounce)\n');

  // Phase 2: MCP Host failure (secondary blast radius)
  await sleep(2000);
  console.log('Phase 2: MCP_HOST_01 cascade failure — sending 30 P1 signals...');
  for (let i = 0; i < 30; i++) {
    await post('/signals', {
      componentId: 'MCP_HOST_01',
      componentType: 'MCP_HOST',
      errorType: 'TOOL_EXECUTION_FAILURE',
      severity: 'P1',
      message: `MCP host dropped connection — attempt ${i + 1}`,
      payload: { mcpServer: 'mcp-host-01.internal', tool: 'database_query' },
    });
    if (i % 10 === 9) process.stdout.write('.');
    await sleep(50);
  }
  console.log('\n✓ 30 MCP signals sent\n');

  // Phase 3: Cache degradation
  await sleep(1000);
  console.log('Phase 3: CACHE_CLUSTER_01 degradation — sending 15 P2 signals...');
  for (let i = 0; i < 15; i++) {
    await post('/signals', {
      componentId: 'CACHE_CLUSTER_01',
      componentType: 'CACHE',
      errorType: 'EVICTION_SPIKE',
      severity: 'P2',
      message: `Cache eviction rate abnormal — ${(50 + i * 3)}%`,
    });
    await sleep(100);
  }
  console.log('✓ 15 cache signals sent\n');

  console.log('✅ Simulation complete!');
  console.log('   Open http://localhost:3000 to see the incidents dashboard');
  console.log('   Expected: 3 WorkItems created (one per componentId), debounced from 165 signals');
}

main().catch((e) => { console.error('Simulation failed:', e.message); process.exit(1); });
