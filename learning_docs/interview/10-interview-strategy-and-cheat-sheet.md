# BrokeTM — 10–15 Minute Interview Strategy & Game Plan

This guide outlines your exact spoken script, timing, and defensive strategy for a 10-to-15 minute technical interview segment focused on **BrokeTM**.

---

## ⏱️ Minute-by-Minute Game Plan

```
[00:00 - 01:30]  The 90-Second Elevator Pitch
[01:30 - 04:30]  The Core Technical Deep Dive: MongoDB Transactions & Replica Set Docker
[04:30 - 07:30]  The STAR Bug Story (The Hardest Technical Problem You Solved)
[07:30 - 10:30]  The Scale Defense ("Where Does BrokeTM Break at 10,000 TPS?")
[10:30 - 12:00]  Connecting to the Job: Microservices & NestJS Transition
[12:00 - 15:00]  Closing & Reverse Questions
```

---

## 1. The 90-Second Elevator Pitch

> *"BrokeTM is a peer-to-peer payment platform built to handle high-concurrency internal money transfers and ledger updates.
> 
> Architecturally, it is structured as a decoupled MERN application:
> - On the frontend, we built a responsive React SPA styled with Tailwind CSS for user balance displays and money transfers.
> - On the backend, we built an Express REST API with custom route guards for JWT authentication and Zod for strict runtime schema validation.
> 
> The core engineering challenge was ensuring that money transfers remain mathematically consistent under concurrent access. To prevent race conditions and double-spending, we implemented MongoDB multi-document ACID transactions using Mongoose sessions.
> 
> Because MongoDB transactions strictly require a Replica Set for WiredTiger oplog replication, we containerized MongoDB using a custom Docker image that automates replica set initialization locally on container boot, giving us an instant, reproducible transactional testing environment."*

---

## 2. The STAR Bug Story: The Hardest Technical Challenge

Interviewers will ask:  
*"Tell me about a difficult technical bug or challenge you encountered while building BrokeTM."*

### 🌟 Situation
> *"When implementing our payment transfer logic, we initially tested single-document updates. However, we quickly realized that debiting the sender and crediting the recipient was vulnerable to intermediate failures and race conditions, meaning a failed server could debit money without crediting the recipient."*

### 🎯 Task
> *"I needed to wrap the dual-update operation inside a MongoDB multi-document ACID transaction using Mongoose sessions so both updates would succeed or fail as an atomic unit."*

### ⚙️ Action
> *"When I first invoked `session.startTransaction()`, our local Node.js backend immediately crashed with an obscure MongoDB error:  
> `MongoServerError: Transaction numbers are only allowed on a replica set member or mongos`.
> 
> I researched MongoDB’s WiredTiger storage engine internals and discovered that transactions rely on the replication Oplog (operations log) to track snapshot states and rollback points. A default standalone `mongod` instance does not maintain an oplog.
> 
> Rather than forcing team members to install complex multi-node replica set clusters locally, I containerized MongoDB with a custom Dockerfile based on `mongo:4.4.7`. I configured it with `--replSet rs` and mounted an initialization script in `/docker-entrypoint-initdb.d/` running `rs.initiate()`. This automated single-node replica set creation on container startup."*

### 🏆 Result
> *"This unlocked full local multi-document ACID transactional semantics for our entire development and testing workflow with zero manual cluster configuration, while completely eliminating balance inconsistencies and partial debit bugs."*

---

## 3. Scale Defense: "Where Does BrokeTM Break at 10,000 TPS?"

Interviewers love to test your architectural ceiling by pushing your project to massive scale.

#### 1. Database Lock Contention (WiredTiger Write Conflicts)
* **The Breaking Point:** At 10,000 transfers per second, multiple concurrent transactions trying to update popular accounts will experience frequent `WriteConflictException` errors, causing transaction aborts and latency spikes.
* **The Solution:** Implement in-memory distributed locks via Redis Redlock to sequence requests per account before hitting the database, or adopt an event-driven ledger using Apache Kafka with account-based partition keys.

#### 2. The Monolith Single-Threaded Event Loop
* **The Breaking Point:** A single Node.js process running Express will max out a single CPU core under high JSON parsing and cryptographic load.
* **The Solution:** Use Node.js Cluster mode or deploy multiple container replicas on AWS ECS / GCP Cloud Run behind an Application Load Balancer with auto-scaling.

#### 3. Single Point of Failure for the Database
* **The Breaking Point:** A single primary MongoDB replica set can become saturated with write operations.
* **The Solution:** Transition to a **MongoDB Sharded Cluster** sharded by `userId`, distributing write operations across multiple independent shards.

---

## 4. Spoken Defense Scripts for Common Traps

### Q: "Why did you use JWT instead of stateful server sessions?"
> *"Stateless JWTs eliminate the need to look up session data in a database on every HTTP request, allowing our API instances to scale horizontally behind a load balancer without needing sticky sessions or a shared Redis session store. We include the `userId` in the payload, verify the HMAC signature with `jwt.verify()`, and authorize protected endpoints in microseconds."*

### Q: "How would you handle a user double-clicking 'Transfer' rapidly?"
> *"We defend against this on two layers:
> 1. On the frontend, we disable the submit button immediately upon click and display a loading spinner.
> 2. On the backend, we require an `Idempotency-Key` header (UUID v4) for every transfer. If a request arrives with an existing key, the backend returns the cached transfer receipt without executing the transaction a second time."*
