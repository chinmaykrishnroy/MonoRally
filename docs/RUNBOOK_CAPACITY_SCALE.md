# MonoRally Operational Capacity & Scale Runbook (v1.12.0)

This operational runbook provides the engineering and SRE manual for managing, monitoring, sizing, and autoscaling **MonoRally** across distributed topologies. The architecture supports configurable worker autoscaling up to 200 replicas; production capacity remains subject to measured infrastructure-specific load testing.

---

## 1. Production Architecture Overview

MonoRally operates as a cloud-native, decoupled distributed architecture:

```
                                [ Client WebSockets ]
                                          │
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
            [ Gateway Pod 1 ]                         [ Gateway Pod N ]
          (Edge WS Termination)                     (Edge WS Termination)
                     │                                         │
                     ├────────────────────┬────────────────────┤
                     ▼                    ▼                    ▼
             [ NATS Message Bus ]  [ Redis Registry ]  [ PostgreSQL DB ]
              (Pub/Sub & RPC)       (Presence, Leases) (Stats, Elo, Matches)
                     ▲                    ▲                    ▲
                     ├────────────────────┴────────────────────┤
                     │                                         │
            ┌────────┴────────┐                       ┌────────┴────────┐
            ▼                 ▼                       ▼                 ▼
   [ Matchmaker Pod ]  [ Worker Pod 1 ]      ...     [ Worker Pod 200 ]
   (Queue Allocation)  (60Hz Court Physics)          (60Hz Court Physics)
```

### Component Roles & Responsibilities
- **Gateway Pods (`monorally-gateway`)**: Terminate TLS/WebSocket connections from clients, validate tokens/names, enforce 160 Hz input rate limiting, forward client inputs to NATS subjects `room.<CODE>.input`, and push 30 Hz snapshots back to clients.
- **Worker Pods (`monorally-worker`)**: Authoritative 60 Hz in-RAM physics simulation nodes. Each worker manages up to 50 active courts (`WORKER_CAPACITY_MAX_ROOMS=50`). They acquire room leases in Redis, calculate continuous collision detection, integrate spin physics, and publish delta snapshots at 30 Hz to `room.<CODE>.state`.
- **Matchmaker Pod (`monorally-matchmaker`)**: Consumes matchmaking queue events (`matchmaker.queue.join`), matches player pairs by rating/mode, queries Redis worker registry for the least-loaded worker, and issues room allocation RPCs.
- **NATS Message Bus**: High-throughput, sub-millisecond pub/sub fabric handling all internal cross-replica message streams.
- **Redis Cluster**: Manages worker heartbeats, room leases (`15s` TTL, renewed every `5s`), distributed rate limiting, and player presence.
- **PostgreSQL**: Stores persistent player accounts, Elo ratings, match histories, and global leaderboards.

---

## 2. Mathematical Capacity Formulas & Budget Model

### 2.1 Network Bandwidth Model

#### Per Client Ingress (Client -> Gateway -> Worker)
- **Input packet**: 14 bytes binary payload + 4 bytes WS frame + 40 bytes IP/TCP header = **58 bytes** per packet.
- **Frequency**: 60 Hz input send rate.
- **Ingress per player**: `58 bytes * 60 packets/s = 3,480 bytes/s (~3.48 KB/s / 27.8 Kbps)`.

#### Per Client Egress (Worker -> Gateway -> Client)
- **Snapshot packet**: ~120 bytes binary snapshot + 40 bytes headers = **160 bytes** per packet.
- **Frequency**: 30 Hz network tick rate.
- **Egress per player**: `160 bytes * 30 packets/s = 4,800 bytes/s (~4.8 KB/s / 38.4 Kbps)`.

#### Aggregate Court Throughput
- **Single 1v1 Court (2 players)**:
  - Ingress: `2 * 3.48 KB/s = 6.96 KB/s`
  - Egress: `2 * 4.80 KB/s = 9.60 KB/s`
  - Total Bandwidth: `~16.56 KB/s (~132.5 Kbps)`.

#### Cluster-Wide Scale at 200 Worker Replicas (10,000 Courts / 20,000 CCU)
- **Active Courts**: 10,000 concurrent courts.
- **Simultaneous Players**: 20,000 CCU (+ spectators).
- **Cluster Ingress**: `20,000 * 3.48 KB/s = 69.6 MB/s (556.8 Mbps)`.
- **Cluster Egress**: `20,000 * 4.80 KB/s = 96.0 MB/s (768.0 Mbps)`.
- **Aggregate Edge Bandwidth**: **~1.32 Gbps**.

---

### 2.2 Memory Footprint Model

```
Worker Pod RSS = Base Node.js Footprint + (Active Courts * Per-Court Footprint)
```
- **Base Node.js 22 Runtime**: ~42 MB RSS (modules, V8 heap, NATS client connection).
- **Per Active Court Footprint**:
  - Court entity & state machines: ~24 KB
  - Paddle kinematics & ball vectors: ~12 KB
  - Input sample history ring buffers (1,000 ms at 60 Hz): ~380 KB per player = ~760 KB
  - Scored state packet buffers: ~64 KB
  - Rematch and cheer tracking: ~16 KB
  - **Total per active court**: **~876 KB** (safe sizing: **1.1 MB**).

#### Worker Pod Memory Sizing (50 Courts per Pod)
- 50 active courts * 1.1 MB = **55 MB**.
- Base footprint: **42 MB**.
- Total Expected RSS at 100% capacity: **~97 MB**.
- Kubernetes Resource Configuration:
  - `requests.memory: 64Mi`
  - `limits.memory: 256Mi` (gives **2.6x** safety headroom).

---

### 2.3 CPU Utilization Model

- **Physics Simulation Tick**: Each court tick takes **~0.06 to 0.09 ms** of CPU time on modern x86-64 / ARM Neoverse cores.
- **At 50 active courts**:
  - `50 courts * 0.08 ms = 4.0 ms` per physics tick.
  - Physics tick interval is `16.66 ms` (60 Hz).
  - Physics CPU Duty Cycle: `4.0 ms / 16.66 ms = 24.0%` of one CPU core.
  - Snapshot serialization & bus dispatch (30 Hz): ~12% of one core.
- **Total Worker CPU at 50 courts**: **~0.36 vCPU**.
- Kubernetes Resource Configuration:
  - `requests.cpu: 100m`
  - `limits.cpu: 500m` (gives **1.4x** burst headroom).

---

## 3. Sizing Matrix (100 CCU to 20,000 CCU)

| Metric / Tier | 100 CCU | 1,000 CCU | 5,000 CCU | 20,000 CCU |
| :--- | :--- | :--- | :--- | :--- |
| **Concurrent Courts** | 50 | 500 | 2,500 | 10,000 |
| **Worker Pods (50 rms/pod)** | 2 | 12 | 60 | 200 |
| **Gateway Pods (500 conn/pod)**| 2 | 3 | 12 | 45 |
| **Matchmaker Pods** | 1 | 1 | 2 | 2 |
| **Cluster Edge Ingress** | 0.35 MB/s | 3.48 MB/s | 17.4 MB/s | 69.6 MB/s |
| **Cluster Edge Egress** | 0.48 MB/s | 4.80 MB/s | 24.0 MB/s | 96.0 MB/s |
| **Total Bandwidth** | ~6.6 Mbps | ~66.2 Mbps | ~331 Mbps | ~1.32 Gbps |
| **Total Worker RAM** | ~200 MB | ~1.2 GB | ~6.0 GB | ~20.0 GB |
| **Total Worker CPU** | ~0.7 vCPU | ~4.3 vCPU | ~21.6 vCPU | ~72.0 vCPU |
| **Kubernetes Node Sizing** | 1x 4 vCPU / 8GB | 2x 4 vCPU / 8GB | 4x 8 vCPU / 16GB | 10x 8 vCPU / 16GB |

---

## 4. Autoscaling Policy & Threshold Tuning

### 4.1 HorizontalPodAutoscaler Configuration (`deploy/k3s/hpa.yaml`)

#### Worker Autoscaling (`monorally-worker-hpa`)
- **Target Metric**: Average CPU utilization `70%` and Memory utilization `80%`.
- **Scaling Limits**: `minReplicas: 3`, `maxReplicas: 200`.
- **Scale-Up Behavior**:
  - Immediate (`stabilizationWindowSeconds: 0`).
  - Max rate: `100%` increase or `10 pods` every 15 seconds.
- **Scale-Down Behavior**:
  - `stabilizationWindowSeconds: 300` (5 minutes).
  - Max rate: `10%` per 60 seconds.
  - **Rationale**: Games typically last 60–180 seconds. A 5-minute stabilization window prevents killing active rooms during momentary pauses between rallies.

#### Gateway Autoscaling (`monorally-gateway-hpa`)
- **Target Metric**: Average CPU utilization `75%`.
- **Scaling Limits**: `minReplicas: 2`, `maxReplicas: 50`.
- **Scale-Down Behavior**: `stabilizationWindowSeconds: 120`.

---

### 4.2 Graceful Draining & Zero-Downtime Rolling Updates

When a worker pod receives a termination signal (`SIGTERM`) or is scaled down:
1. Kubernetes triggers the `preStop` hook:
   ```sh
   fetch('http://127.0.0.1:8787/drain', { method: 'POST' })
   ```
2. Worker marks its status as `"draining"` in the Redis worker registry (`markWorkerDraining`).
3. Matchmaker immediately stops assigning new rooms to this worker.
4. Active rooms continue simulating until conclusion. As each match ends, the worker releases the room lease and does not accept rematches.
5. Once `worker.rooms.size === 0`, the process cleans up and exits cleanly with code 0.
6. `terminationGracePeriodSeconds: 120` ensures standard 2-minute matches finish without abrupt disconnections.

---

## 5. Prometheus Observability & Alerting Rules

Each pod exports standard Prometheus metrics on `/metrics` (and `/metrics.json` for JSON parsers).

### Critical Prometheus Alert Definitions

```yaml
groups:
  - name: monorally_alerts
    rules:
      - alert: MonoRallyHighTickLatency
        expr: monorally_tick_duration_ms{quantile="0.99"} > 10.0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Physics loop p99 tick latency exceeds 10ms (SLO deadline 16.6ms)"
          description: "Worker {{ $labels.instance }} is experiencing elevated physics tick duration."

      - alert: MonoRallyTickDeadlineExceeded
        expr: monorally_tick_duration_ms{quantile="0.99"} >= 16.6
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Physics loop has breached the 60 Hz frame deadline"
          description: "Worker {{ $labels.instance }} cannot maintain 60 FPS physics."

      - alert: MonoRallyClusterCapacityHigh
        expr: avg(monorally_worker_capacity_ratio) > 0.85
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "Cluster active room capacity exceeds 85%"
          description: "Worker capacity is nearly saturated. HPA should scale up additional replicas."

      - alert: MonoRallyMatchmakerBacklog
        expr: monorally_matchmaker_queue_length > 50 or monorally_matchmaker_wait_duration_ms{quantile="0.95"} > 8000
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Matchmaking queue is congested"
          description: "Players are waiting longer than 8s to be matched."

      - alert: MonoRallyHighClientRtt
        expr: monorally_client_rtt_ms{quantile="0.95"} > 180.0
        for: 5m
        labels:
          severity: info
        annotations:
          summary: "Client round-trip latency elevated"
          description: "95% of players experiencing >180ms RTT on gateway {{ $labels.instance }}."
```

---

## 6. Incident Response & Troubleshooting Playbooks

### Playbook 1: Elevated Physics Tick Duration (> 16.6 ms)
1. **Identify affected worker pods**:
   ```sh
   kubectl top pods -l app.kubernetes.io/name=monorally-worker
   ```
2. **Inspect per-room count**:
   ```sh
   curl -s http://<POD_IP>:8787/metrics.json | jq '.rooms'
   ```
3. **Check CPU throttling**:
   Verify if the container is being throttled by Kubernetes cgroups quota:
   ```sh
   kubectl get --raw "/api/v1/nodes/<NODE>/proxy/stats/summary"
   ```
4. **Remediation**:
   - If CPU utilization > 90%, increase `WORKER_CAPACITY_MAX_ROOMS` lower limit (e.g. from 50 to 35) or bump pod CPU limit to `750m`.

---

### Playbook 2: Matchmaking Queue Congestion
1. **Symptoms**: `monorally_matchmaker_queue_length` keeps climbing, players report fallback to AI.
2. **Diagnosis**:
   - Check if workers are available:
     ```sh
     kubectl get pods -l app.kubernetes.io/name=monorally-worker
     ```
   - Check if all workers are draining or at capacity:
     ```sh
     curl -s http://<GATEWAY_IP>:8787/metrics.json | jq '.rooms.workerCapacityRatio'
     ```
3. **Remediation**:
   - Manually scale workers if HPA is lagging:
     ```sh
     kubectl scale deployment monorally-worker --replicas=30
     ```

---

### Playbook 3: Zero-Downtime Rolling Update Verification
To deploy a new container release (e.g. `1.12.0`):
1. **Apply deployment update**:
   ```sh
   kubectl set image deployment/monorally-worker worker=ghcr.io/chinmaykrishnroy/monorally:1.12.0
   ```
2. **Watch graceful drain progression**:
   ```sh
   kubectl get pods -l app.kubernetes.io/name=monorally-worker -w
   ```
3. Verify that old pods transition through `Terminating` only after active matches complete or the 120s grace period elapses.

---

### Playbook 4: Running Multi-Replica Scale Benchmarks
To validate cluster capacity before a major tournament:
```sh
# Run synthetic 10-worker, 30-player scale test
npm run test:scale -- --workers=10 --pairs=15 --duration=10 --format=markdown

# Run heavy 50-worker scale test
node scripts/scale-benchmark.js --workers=50 --gateways=10 --pairs=100 --duration=15
```
Verify that all outputs report `PASS` with dynamically evaluated sampled tick measurements under the 16.6ms SLO deadline.
