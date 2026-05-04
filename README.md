# ⚡ Incident Management System (IMS)

**Zeotap SRE Intern Assignment** — Syeda  
A production-grade incident management system that ingests high-volume failure signals, debounces them into work items, and provides a workflow-driven UI to track incidents to closure with mandatory Root Cause Analysis.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SIGNAL SOURCES                               │
│  [API errors] [Cache failures] [DB latency] [Queue] [MCP faults]   │
└────────────────────────┬────────────────────────────────────────────┘
                         │ HTTP POST /api/signals (JSON)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    INGESTION LAYER                                  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Express API  →  Rate Limiter (500 req/min)                  │  │
│  │       │                                                       │  │
│  │       ▼                                                       │  │
│  │  In-Memory Queue (async buffer — handles 10k signals/sec)    │  │
│  │       │                                                       │  │
│  │       ▼                                                       │  │
│  │  Signal Processor (setImmediate batching, non-blocking)      │  │
│  │       │                                                       │  │
│  │       ▼                                                       │  │
│  │  Debounce Engine  ←── 10s window per componentId            │  │
│  │  (100 signals → 1 WorkItem, all 100 linked)                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────┬─────────────────┬────────────────┬───────────────────────────┘
       │                 │                │
       ▼                 ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   MongoDB    │  │   MongoDB    │  │    Redis     │
│  (signals)   │  │  (workItems) │  │   (cache)    │
│              │  │              │  │              │
│ Raw audit    │  │ Work items   │  │ Hot-path     │
│ log — every  │  │ + RCA        │  │ dashboard    │
│ signal ever  │  │ Transactional│  │ state        │
│ received     │  │ writes       │  │ 5-min TTL    │
└──────────────┘  └──────────────┘  └──────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKFLOW ENGINE                                  │
│                                                                     │
│  State Pattern:  OPEN → INVESTIGATING → RESOLVED → CLOSED          │
│                                                                     │
│  Strategy Pattern:  RDBMS→P0Alert  |  CACHE→P2Alert  |  ...       │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    REACT FRONTEND                                   │
│                                                                     │
│  [Live Feed — sorted by severity, auto-refresh 5s]                 │
│  [Incident Detail — signals table + workflow controls]              │
│  [RCA Form — datetime pickers, dropdown, textarea]                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start (Docker Compose)

### Prerequisites
- Docker Desktop installed and running
- Git

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/ims-zeotap.git
cd ims-zeotap

# 2. Start everything (MongoDB + Redis + Backend + Frontend)
docker-compose up --build

# 3. Open the dashboard
open http://localhost:3000

# 4. Check system health
curl http://localhost:4000/health

# 5. Run the cascade failure simulation (in a new terminal)
node scripts/simulate_outage.js
```

Wait about 30 seconds for all services to be healthy. The frontend polls `/health` and shows service status in real time.

---

## How to Use the Dashboard

1. **View active incidents** — sorted by severity (P0 at top). Auto-refreshes every 5 seconds.
2. **Click an incident** — see all raw signals linked to it, component info, and current workflow status.
3. **Advance the workflow** — click "Move to INVESTIGATING", then "Move to RESOLVED".
4. **Submit RCA** — click "Submit RCA" or "Fill RCA first" before closing. Fill all required fields.
5. **Close the incident** — after RCA is saved, click "Move to CLOSED". System calculates MTTR automatically.

---

## API Reference

### Ingest a Signal
```http
POST /api/signals
Content-Type: application/json

{
  "componentId": "RDBMS_PRIMARY",
  "componentType": "RDBMS",
  "errorType": "CONNECTION_TIMEOUT",
  "severity": "P0",
  "message": "Primary database unreachable",
  "payload": { "host": "db.internal", "latencyMs": 5000 }
}
```
Returns `202 Accepted` immediately. Processing is async.

### List Work Items
```http
GET /api/work-items?status=OPEN&severity=P0&limit=50
```

### Get Work Item Detail
```http
GET /api/work-items/:workItemId
```

### Advance Status
```http
PATCH /api/work-items/:workItemId/status
{ "status": "INVESTIGATING" }
```

### Submit RCA
```http
POST /api/work-items/:workItemId/rca
{
  "incidentStart": "2024-01-15T10:00:00Z",
  "incidentEnd": "2024-01-15T11:30:00Z",
  "rootCauseCategory": "INFRA_FAILURE",
  "fixApplied": "Restarted primary database and promoted replica",
  "preventionSteps": "Added automated failover and alerting on replication lag"
}
```

### Health Check
```http
GET /health
```
```json
{
  "status": "healthy",
  "services": { "mongodb": "up", "redis": "up" },
  "metrics": {
    "signalsPerSecond": 142.5,
    "queueDepth": 0,
    "totalProcessed": 12847,
    "activeDebounceWindows": 3
  }
}
```

---

## How Backpressure is Handled

This is the most important resilience design decision in the system.

**The problem:** MongoDB writes take ~5–20ms each. At 10,000 signals/second, you cannot write each signal to Mongo synchronously — the process would run out of memory or crash.

**The solution: In-memory async queue with batch processing**

```
HTTP request → push to [] (instant, never blocks) → return 202
                    ↓
           setImmediate(processQueue)  ← scheduled after current I/O
                    ↓
           drain in batches of 50 using Promise.allSettled
                    ↓
           yield to event loop between batches (setImmediate)
```

Key properties:
- **The HTTP handler never waits for DB.** It pushes to an array and returns `202 Accepted` in microseconds.
- **`Promise.allSettled`** means one failed DB write doesn't block the rest of the batch.
- **`setImmediate` between batches** yields to Node's event loop so other I/O (HTTP requests, Redis pings) can be served during heavy load.
- **The queue is in-memory**, so if Mongo is slow, signals accumulate safely in RAM rather than crashing or blocking the HTTP server.
- **Debounce windows use `Map` + `setTimeout`**, which are O(1) lookup — no performance degradation at scale.

**What's NOT implemented (production additions):**
- Persistent queue (e.g. Kafka, BullMQ) for crash recovery
- Dead-letter queue for repeatedly failing signals
- Circuit breaker on Mongo/Redis connections

---

## Design Patterns Used

### 1. Strategy Pattern — Alerting
`src/services/alertingStrategy.js`

Different component types require different alert urgency:
- `RDBMS` failure → `P0CriticalAlert` (would call PagerDuty)
- `MCP_HOST` failure → `P1HighAlert` (Slack #incidents)
- `CACHE` failure → `P2StandardAlert` (email)
- Other components → severity-based strategy

The `AlertingStrategy.forComponent()` factory returns the right strategy. Adding a new alert type means adding a new class — existing code doesn't change (Open/Closed Principle).

### 2. State Pattern — Work Item Lifecycle
`src/models/WorkItem.js`

Work items follow a strict one-way state machine:
```
OPEN → INVESTIGATING → RESOLVED → CLOSED
```
This is enforced in Mongoose pre-save hooks:
- The model tracks `_previousStatus` on init
- Any attempt to jump states (e.g. OPEN → CLOSED) throws an error
- Mongoose transactions ensure the state write is atomic
- The CLOSED gate also validates RCA completeness

---

## Debounce Logic Explained

```
t=0s:  Signal 1 arrives for CACHE_CLUSTER_01
       → No open window → Create WorkItem WI-001 → Open 10s window
       
t=1s:  Signals 2–50 arrive for CACHE_CLUSTER_01
       → Window open → Link all to WI-001 → increment signalCount
       
t=8s:  Signals 51–100 arrive for CACHE_CLUSTER_01
       → Window still open → Link all to WI-001
       → signalCount = 100 → log threshold warning
       
t=10s: Window expires → deleted from Map
       → Next signal for CACHE_CLUSTER_01 opens a NEW window
       → Creates WorkItem WI-002
```

Result: 100 signals → 1 WorkItem. All 100 raw signals are stored in MongoDB with `workItemId: WI-001`. The NoSQL store acts as the audit trail; the work item is the source of truth.

---

## Mandatory RCA Validation

The system enforces RCA at multiple levels:

1. **API level:** `POST /rca` uses Joi schema validation — all fields required, min lengths enforced, end date must be after start date.
2. **Model level:** Mongoose pre-save hook checks RCA completeness before allowing `CLOSED` status.
3. **Frontend level:** The "Move to CLOSED" button prompts for RCA first if it's missing.
4. **MTTR calculation:** Auto-calculated as `(incidentEnd - incidentStart) / 60000` in minutes, stored alongside the RCA.

---

## Running Tests

```bash
cd backend
npm install
npm test
```

Tests cover:
- RCA validation (complete vs incomplete RCA)
- State machine valid and invalid transitions
- MTTR calculation accuracy
- Alerting strategy selection (correct class returned per component type)

---

## Tech Stack Choices

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend runtime | Node.js (Express) | Non-blocking I/O ideal for high-throughput async signal processing |
| Primary DB | MongoDB | Flexible schema for raw signals (varying payloads); easy horizontal scaling |
| Source of truth | MongoDB (separate collection) | Transactional writes for work items and RCA |
| Cache | Redis | Sub-millisecond reads for dashboard hot-path; TTL-based invalidation |
| Frontend | React | Component model fits the dashboard + detail + form structure |
| Serving | nginx | Proxies `/api` to backend, serves React SPA with proper routing |
| Containerization | Docker Compose | Single command to start all 4 services with health checks |

---

## Non-Functional Items (Bonus)

### Security
- `helmet` middleware sets secure HTTP headers (XSS protection, HSTS, etc.)
- Rate limiter on ingestion endpoint prevents DDoS / cascade amplification
- Input validation via Joi on all POST endpoints
- CORS configured (restrict in production to known origins)

### Observability
- `/health` endpoint with per-service status and live throughput metrics
- Winston structured JSON logging with timestamps
- Throughput metrics (signals/sec, queue depth) printed to console every 5 seconds
- All state transitions logged with workItemId for traceability

### Resilience
- `Promise.allSettled` in batch processing — one bad signal doesn't block others
- Redis cache failures are non-fatal (system falls back to MongoDB)
- MongoDB write retries can be added via Mongoose `retryWrites=true` connection option
- Docker health checks restart unhealthy containers automatically

---

## Project Structure

```
ims/
├── backend/
│   ├── src/
│   │   ├── index.js                 # Express app + bootstrap
│   │   ├── config/
│   │   │   ├── db.js                # MongoDB connection
│   │   │   └── redis.js             # Redis connection
│   │   ├── models/
│   │   │   ├── Signal.js            # Raw signal schema (NoSQL audit log)
│   │   │   └── WorkItem.js          # Work item + RCA + state machine
│   │   ├── routes/
│   │   │   ├── signals.js           # POST /signals, GET /signals
│   │   │   ├── workItems.js         # CRUD + status + RCA
│   │   │   └── health.js            # GET /health
│   │   ├── services/
│   │   │   ├── signalProcessor.js   # Async queue + debounce engine
│   │   │   ├── alertingStrategy.js  # Strategy Pattern
│   │   │   └── metricsLogger.js     # 5s console throughput
│   │   ├── middleware/
│   │   │   ├── rateLimiter.js       # express-rate-limit
│   │   │   └── validate.js          # Joi schemas
│   │   └── utils/
│   │       └── logger.js            # Winston
│   ├── tests/
│   │   └── rca.test.js              # Unit tests
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── App.js                   # Root component + navigation
│   │   ├── App.css                  # Global styles
│   │   ├── api/client.js            # Axios API client
│   │   └── pages/
│   │       ├── Dashboard.js         # Live feed + metrics + filter
│   │       └── IncidentDetail.js    # Signals + workflow + RCA form
│   ├── public/index.html
│   ├── nginx.conf                   # Proxy /api to backend
│   └── Dockerfile
│
├── scripts/
│   └── simulate_outage.js           # Cascade failure simulation
│
├── docker-compose.yml
└── README.md
```

---

## Prompts & Planning Notes

This file documents the approach taken, as required by submission guidelines.

**Approach:**
1. Read assignment → identified 5 core challenges: async queue, debounce, state machine, Strategy Pattern, Redis cache layer
2. Designed the data model first (Signal + WorkItem separation) — raw signals in one collection as audit log, work items as source of truth
3. Built the signal processor as a pure in-memory queue first, then plugged in Mongo/Redis
4. Strategy Pattern implemented as class hierarchy before wiring into processor
5. State machine enforced at Mongoose model level so it can't be bypassed via direct DB access
6. Frontend built page-by-page: Dashboard → Detail → RCA form

**Key decisions:**
- `setImmediate` over `process.nextTick` for queue draining — `nextTick` starves I/O, `setImmediate` yields after each phase
- `Promise.allSettled` over `Promise.all` in batch processor — prevents one bad DB write from dropping the whole batch
- Redis cache is non-fatal — the system degrades gracefully to MongoDB if Redis is down
- MTTR stored as integer minutes on the RCA object, not computed on read

---

*GitHub repository: [ADD LINK HERE]*
