# BrokeTM — Core Technical Interview Playbook

This document prepares you to defend every single bullet point from your resume for **BrokeTM** during senior engineering interviews. It follows the **3-Step Delivery Framework**:
1. **The Executive Pitch (15–20s):** What it is and the architectural rationale.
2. **The BrokeTM Implementation (20–30s):** Exact files, schemas, queries, and routes in the repository.
3. **The Defense & Follow-up (15–20s):** Failure modes, race conditions, concurrency bugs, and trade-offs.

---

## Resume Bullet 1: Full-Stack P2P Payments Architecture

> *"Architected a full-stack peer-to-peer payments application enabling instant in-house money transfers and account management using React, Node.js, Express.js, MongoDB, and Tailwind CSS."*

### 🎯 1. The Spoken Pitch
> *"BrokeTM is a peer-to-peer payment platform built to handle high-concurrency internal money transfers and ledger updates.
> 
> The application uses a decoupled MERN architecture:
> - **Frontend:** React SPA styled with Tailwind CSS, utilizing component-level isolation for user search, real-time balance checks, and transfer modals.
> - **Backend:** Node.js with Express.js handling RESTful endpoints mounted under `/api/v1/user` and `/api/v1/account`.
> - **Persistence Layer:** MongoDB with Mongoose ODM modeling users and accounts with strict schema constraints.
> 
> The central engineering challenge was ensuring that financial transfers remain mathematically consistent under concurrent access, which we achieved by enforcing database transactions and atomic operations."*

### 📖 Key Concepts Explained Simply (React SPA & ODM)

#### 1. What is a React SPA (Single-Page Application)?
* **The Traditional Website (Multi-Page App / MPA):** When you click a link (e.g. from `/home` to `/dashboard`), your browser sends a request to the server. The server builds an entirely new HTML file, sends it back, and the browser screen flashes white while it reloads everything from scratch (CSS, JS, images).
* **The React SPA (Single-Page App):** The browser loads a single `index.html` file **just once**. When you click on "Send Money" or "Dashboard", the page **does not reload**. Instead, client-side JavaScript (React Router) intercepts the click, fetches only the necessary raw JSON data from the backend, and dynamically re-renders just that part of the DOM.
* **Why BrokeTM is an SPA:** For a financial dashboard, users expect instant, app-like responsiveness without page flickers when checking balances or transferring funds.

#### 2. What is an ODM (Object-Document Mapper)?
* **The Core Definition:** An ODM is a software library that bridges the gap between **JavaScript Objects in your code** and **JSON/BSON Documents in a NoSQL database (MongoDB)**. It is the NoSQL counterpart of an ORM (Object-Relational Mapper like Hibernate or Prisma for SQL).
* **Without an ODM (Raw Driver):** You would have to manually format queries and validate data by hand:
  ```javascript
  // Raw MongoDB driver (no schema enforcement)
  const db = client.db('broketm');
  await db.collection('accounts').updateOne({ userId: id }, { $inc: { balance: -50 } });
  ```
  If someone passes `balance: "five hundred"` as a string, raw MongoDB will blindly store it, corrupting your database.
* **With Mongoose (Our ODM):**
  1. **Schema Enforcement:** Defines strict field types (`balance: { type: Number, required: true }`).
  2. **Model Abstraction:** Treats collections like classes (`Account.findOne(...)`, `account.save()`).
  3. **Relationship Mapping:** Connects documents across collections using `ref` (`ref: 'User'`).
  4. **Hooks & Validation:** Runs pre/post save lifecycle hooks and type conversions automatically.

### 💻 2. Codebase Anchors & Under the Hood
* **Application Entry (`backend/index.js`):**
  Mounts middleware (`cors`, `express.json()`) and registers API routes:
  ```javascript
  const mainRouter = require('./routes/index');
  app.use('/api/v1', mainRouter);
  ```
* **Routing Hierarchy (`backend/routes/index.js`):**
  Delegates domain-driven endpoints:
  ```javascript
  router.use('/user', userRouter);
  router.use('/account', accountRouter);
  ```
* **Data Models (`backend/db.js`):**
  - `User`: Handles credentials, user names, and unique emails.
  - `Account`: Stores `userId` as an `ObjectId` referencing the `User` collection, and `balance` as an integer.
* **Frontend Shell (`frontend/src/App.jsx`):**
  Implements React client-side routing across Sign In, Sign Up, Dashboard, and Send Money workflows.

### 🛡️ 3. Failure Defense & Follow-up Questions

#### Q: "Why store user information and account balances in separate collections instead of a single embedded document?"
* **Spoken Defense:**
  > *"Separating `User` and `Account` enforces the principle of **separation of concerns** and reduces database lock contention.
  > 
  > In financial systems, user profile updates (like updating a name or phone number) occur with low frequency and low financial risk. In contrast, account balances are hot data paths updated during rapid transactions and require aggressive locking or atomic writes.
  > 
  > If `balance` was embedded inside `User`, an update to a user's profile could trigger a document write lock that delays a financial transfer, or vice versa. By isolating `Account` to `{ userId, balance }`, we keep the ledger document minimal, fast, and cleanly isolated."*

---

## Resume Bullet 2: Atomic Fund Transfers & Concurrency Control

> *"Implemented atomic fund transfers using MongoDB multi-document ACID transactions and Mongoose sessions, preventing race conditions and double-spending across concurrent account debits."*

### 🎯 1. The Spoken Pitch
> *"In a peer-to-peer payment transfer, crediting one user and debiting another must execute as a single atomic unit of work. If the server crashes mid-flight, or if the recipient's account is invalid, the sender's balance must not be permanently deducted.
> 
> To prevent double-spending and data corruption, we implemented MongoDB multi-document ACID transactions via Mongoose sessions. We initialize a session, start a transaction, fetch accounts within the transactional snapshot, verify the sender's balance, issue atomic updates (`$inc: -amount` and `$inc: +amount`), and commit. If any condition fails, `abortTransaction()` rolls back all writes."*

### 📖 Key Concepts Explained Simply (Race Conditions, Sessions, Snapshots, WiredTiger & MVCC vs. OCC)

#### 1. What is a Race Condition?
* **The ATM Analogy:** Imagine you have \$100 in your bank account. You and a friend try to withdraw \$100 from two separate ATMs at the exact same second.
  - ATM 1 reads your balance: *"Balance is \$100. Sufficient!"*
  - ATM 2 reads your balance before ATM 1 updates it: *"Balance is \$100. Sufficient!"*
  - Both ATMs dispense \$100 cash. Your balance drops to -\$100. You just withdrew \$200 from a \$100 balance!
* **The Technical Term (TOCTOU):** This is a **Time-of-Check to Time-of-Use** race condition. The system verified the balance was sufficient, but between the *check* and the *deduction*, another operation altered the reality.

#### 2. What is a Mongoose Session (`mongoose.startSession()`)?
* **The Core Concept:** A session is a **dedicated logical connection context** leased from MongoDB's client connection pool.
* **Why it is Mandatory for Transactions:**
  - By default, MongoDB handles each query independently over whichever random connection is idle.
  - To execute a transaction, MongoDB needs to bind all related operations (reads, balance checks, debits, credits) to **one continuous conversation** identified by a single Transaction ID (`txnNumber`).
  - The Mongoose `session` object is that conversation tracker.
  - **The Golden Rule:** You must explicitly attach `.session(session)` to every Mongoose query inside the transaction. If you forget it on even one query, that operation executes outside the transaction's isolation bubble!

#### 3. What is a Transaction Snapshot?
* **The Photo Analogy:** Think of taking a point-in-time **photograph** of the database at timestamp $T_0$ when the transaction starts.
* **How it Works:** All queries executed within that session read from this isolated point-in-time snapshot.
* **Why it Matters:** Even if 1,000 other users are making purchases and updating balances in other collections, your transaction reads data consistently as it existed at $T_0$. This guarantees **Snapshot Isolation**, preventing "dirty reads" (seeing half-written data from other transactions).

#### 4. What is WiredTiger?
* **The Core Definition:** WiredTiger is the default, high-performance C-based **storage engine** running inside MongoDB (acquired by MongoDB in 2014).
* If MongoDB is the car, WiredTiger is the physical engine under the hood. It is responsible for:
  - Reading from and writing blocks to physical disk/SSD.
  - In-memory data caching and Snappy/zlib compression.
  - Writing the Write-Ahead Log (WAL / Oplog / Journal) for crash recovery.
  - Document-level concurrency control (modifying one document doesn't lock the entire collection).

#### 5. MVCC vs. OCC: What's What? (The Confusion Cleared Up)
You may see **MVCC** in some places and **OCC** in others. They are not contradictory; they describe two different layers of the same engine:

```
┌─────────────────────────────────────────────────────────────┐
│   OCC (Optimistic Concurrency Control)                      │
│   --> The Transaction Strategy: Don't lock rows upfront!    │
│       Assume no conflict, detect collisions at commit time. │
├─────────────────────────────────────────────────────────────┤
│   MVCC (Multi-Version Concurrency Control)                  │
│   --> The Underlying Storage Mechanism:                     │
│       Keep multiple timestamped versions of each document.  │
└─────────────────────────────────────────────────────────────┘
```

* **MVCC (Multi-Version Concurrency Control) = How data is stored in memory/disk:**
  - Traditional old databases locked an entire table or row whenever someone read or wrote to it.
  - WiredTiger avoids locking readers by keeping **multiple timestamped versions** of each document. When an update occurs, it creates a new version instead of overwriting the old one immediately.
  - **Result:** *"Readers never block writers, and writers never block readers."*
* **OCC (Optimistic Concurrency Control) = The transaction conflict strategy built on top of MVCC:**
  - Instead of taking heavy, slow "pessimistic" locks on documents upfront (like `SELECT ... FOR UPDATE` in SQL), WiredTiger operates **optimistically**: it assumes concurrent operations will rarely touch the exact same document at the exact same millisecond.
  - Transactions proceed smoothly using their MVCC snapshots.
  - When a transaction tries to write to a document, WiredTiger checks: *"Has another transaction committed a newer version of this document since my snapshot was taken?"*
  - If yes, an optimistic conflict is detected! WiredTiger aborts the transaction with a `WriteConflictException` (error code 112), allowing you to safely rollback or retry.
* **In One Sentence:** *WiredTiger uses **MVCC** (maintaining multiple document versions) to implement an **OCC** strategy (optimistically running transactions and triggering write conflicts if two writers collide).*

### 💻 2. Codebase Anchors & Under the Hood
* **Transactional Transfer Handler (`backend/routes/account.js` lines 68–110):**
  ```javascript
  router.post('/transfer', authMiddleware, async (req, res) => {
      const session = await mongoose.startSession();
      session.startTransaction();
      
      const { amount, to } = req.body;

      // 1. Fetch sender within transactional snapshot
      const account = await Account.findOne({ userId: req.body.userId }).session(session);

      if (!account || account.balance < amount) {
          await session.abortTransaction();
          return res.status(400).json({ message: 'Insufficient balance' });
      }

      // 2. Fetch recipient within transactional snapshot
      const toAccount = await Account.findOne({ userId: to }).session(session);

      if (!toAccount) {
          await session.abortTransaction();
          return res.status(400).json({ message: 'Invalid account' });
      }

      // 3. Atomic Debit and Credit
      await Account.updateOne(
          { userId: req.body.userId },
          { $inc: { balance: -amount } }
      ).session(session);

      await Account.updateOne(
          { userId: to },
          { $inc: { balance: amount } }
      ).session(session);

      // 4. Commit atomic transaction
      await session.commitTransaction();
      res.json({ message: 'Transfer successful' });
  });
  ```

### 🛡️ 3. Failure Defense & Follow-up Questions

#### Q: "What happens if two concurrent requests hit `/transfer` for the same user simultaneously?"
* **Spoken Defense:**
  > *"If two requests arrive at the exact same millisecond, WiredTiger's underlying MVCC engine detects an **Optimistic Concurrency Control (OCC) Write Conflict** when both try to modify the same `Account` document version.
  > 
  > In MongoDB transactions, when two concurrent transactions attempt to modify the same document, the second transaction throws a `WriteConflictException` (error code 112). We catch this exception in our error handler and either retry with exponential backoff or abort with a clean error message.
  > 
  > Additionally, in production, we strengthen the debit query by adding a balance condition directly into the update filter:
  > ```javascript
  > await Account.updateOne(
  >   { userId: req.body.userId, balance: { $gte: amount } },
  >   { $inc: { balance: -amount } }
  > ).session(session);
  > ```
  > If `modifiedCount === 0`, it means the balance dropped below the transfer amount between the read and write, allowing us to abort immediately."*

---

## Resume Bullet 3: Dockerized MongoDB Replica Set

> *"Containerized a MongoDB Replica Set with Docker to support multi-document transactional semantics locally, automating replica set initialization for testing and development."*

### 🎯 1. The Spoken Pitch
> *"By default, a local MongoDB instance runs as a standalone daemon. However, MongoDB's WiredTiger storage engine strictly enforces that multi-document transactions can **only** be executed on replica sets or sharded clusters, because transactions rely on the replication Oplog (operations log) to track snapshot states and rollback operations.
> 
> Running a full multi-server MongoDB cluster on a developer laptop is cumbersome and heavy. We created a custom lightweight Docker container based on `mongo:4.4.7` that starts the daemon with `--replSet rs` and uses an automated startup script in `/docker-entrypoint-initdb.d/` running `rs.initiate()`. This gives every developer an instant, reproducible single-node replica set with full transactional support upon running `docker run`."*

### 📖 Key Concept Explained Simply: What is a Sharded Cluster?

#### 1. Replica Set vs. Sharded Cluster (High Availability vs. Horizontal Scale)
* **A Replica Set (Vertical Scale with High Availability):**
  - Copies the **exact same data** across multiple servers (1 Primary node + multiple Secondary nodes).
  - **Purpose:** Redundancy and failover. If the Primary server crashes, a Secondary is automatically elected as the new Primary in seconds.
  - **Limitation:** It does **not** scale write performance. Every single write and transfer must still go through the single Primary node.
* **A Sharded Cluster (Horizontal Scale / Partitioning):**
  - Slices a massive database into smaller chunks and distributes different slices across multiple independent database clusters called **Shards**.
  - **Purpose:** Scaling when your data or write volume is too massive for a single computer. For example, Shard 1 holds accounts for Users 1–5,000,000, while Shard 2 holds accounts for Users 5,000,001–10,000,000.

#### 2. The 3 Architectural Components of a Sharded Cluster
```
                      ┌──────────────────────┐
                      │  Node.js Backend App │
                      └──────────┬───────────┘
                                 │ Connects to
                                 ▼
                      ┌──────────────────────┐
                      │   mongos (Router)    │
                      └────┬────────────┬────┘
           Asks where to   │            │ Routes query to
           find the data   │            │ correct shard
                           ▼            ▼
             ┌─────────────────┐    ┌─────────────────────────────────┐
             │  Config Server  │    │             Shards              │
             │   Replica Set   │    │  ┌───────────────┐ ┌──────────┐ │
             │ (Metadata & map)│    │  │Shard 1 (RS)   │ │Shard 2(RS)│ │
             └─────────────────┘    │  │(Users 1-5M)   │ │(Users 5M+)│ │
                                    │  └───────────────┘ └──────────┘ │
                                    └─────────────────────────────────┘
```

1. **`mongos` (The Query Router):** A stateless proxy that your Node.js application connects to. It acts like a traffic cop. When your app requests `Account.findOne({ userId: 123 })`, `mongos` figures out which shard has that user and routes the request there.
2. **Config Servers (The Cluster Map):** A small, dedicated replica set that stores cluster metadata and the routing table (recording which chunks of data live on which shard).
3. **Shards (The Storage Engines):** The individual database nodes holding subsets of the data. To ensure high availability, **each shard is itself a replica set**!

#### 3. Why BrokeTM Uses a Single-Node Replica Set Instead of a Sharded Cluster for Local Dev
* In production, high-scale fintechs running MongoDB use Sharded Clusters (supported since MongoDB 4.2 with distributed two-phase commit transactions across shards).
* However, spinning up a local Sharded Cluster requires at least 7–10 running processes (at least 2 shards $\times$ 3 replica nodes each + 3 config nodes + `mongos`), consuming gigabytes of RAM.
* Our custom Docker container running a **single-node Replica Set (`--replSet rs`)** provides 100% of the WiredTiger Oplog transactional semantics with sub-second boot times and minimal RAM consumption.

### 💻 2. Codebase Anchors & Under the Hood
* **Container Definition (`Dockerfile`):**
  ```dockerfile
  FROM mongo:4.4.7
  RUN echo "rs.initiate();" > /docker-entrypoint-initdb.d/replica-init.js
  CMD [ "--replSet", "rs" ]
  ```
* **Docker Lifecycle Mechanism:**
  1. The base image `mongo:4.4.7` runs the official entrypoint script `/usr/local/bin/docker-entrypoint.sh`.
  2. On initial container volume creation, the entrypoint script iterates through `/docker-entrypoint-initdb.d/` and executes all `.js` files using the `mongo` shell.
  3. `replica-init.js` runs `rs.initiate()`, which configures the single node as a replica set primary member named `rs`.
  4. The container daemon continues running with `--replSet rs`, enabling the WiredTiger Oplog and unlocking `session.startTransaction()`.

### 🛡️ 3. Failure Defense & Follow-up Questions

#### Q: "Why did you use MongoDB 4.4 instead of older versions or newer versions?"
* **Spoken Defense:**
  > *"MongoDB 4.0 first introduced multi-document transactions for replica sets, and 4.2 expanded them to sharded clusters. However, MongoDB 4.4 introduced major transaction stability improvements—including configurable transaction lifetimes and hedged reads.
  > 
  > Version 4.4.7 was chosen as a stable, battle-tested release with lightweight memory footprints for containerized local development. In production, we deploy on MongoDB 6.0+ or managed services like MongoDB Atlas or AWS DocumentDB (with transaction support enabled)."*

---

## Resume Bullet 4: JWT Authentication, Route Guards & Zod Validation

> *"Built secure JWT authentication with custom route-guard middleware and enforced strict schema validation and type safety using Zod across all transfer and user payloads."*

### 🎯 1. The Spoken Pitch (Easy & Intuitive)
> *"In any payments application, you have to be paranoid about two critical things: **who is making the request**, and **what data are they sending**.
> 
> In BrokeTM, we protect the system with a clean, two-step front-door defense:
> 1. **Authentication with JWT (The Digital ID Card):** When a user signs up or signs in, we issue a signed JSON Web Token. Whenever they want to see their balance or send money, they attach this token in the header. Our custom route-guard middleware verifies the token's cryptographic signature, so no one can impersonate another user or tamper with user IDs.
> 2. **Input Validation with Zod (The Strict Bouncer):** Before any payload ever touches MongoDB or starts a transaction, Zod parses and validates the incoming JSON. If an attacker submits a negative transfer amount (`-$500`), a malformed email, or extra injection fields, Zod immediately kicks the request out with an error. This protects our database and avoids wasting database transaction resources on bad data."*

### 📖 Key Concepts Explained Simply: Middleware vs. Controller

#### 1. What is Middleware in Express?
* **The Airport Security Analogy:**
  - When you arrive at an airport, you don't walk straight onto the airplane. You pass through a series of checkpoints:
    1. Ticket scan at the entrance.
    2. Metal detector and baggage scanner.
    3. Passport control.
  - In Express, **Middleware functions** are those security checkpoints.
  - A middleware sits directly between the incoming HTTP request and the final route handler. It receives three arguments: `(req, res, next)`:
    - It can inspect or modify the request (e.g. `express.json()` parses the raw request stream into a JavaScript `req.body` object).
    - It can reject the request immediately if something is wrong (e.g. `authMiddleware` returning `res.status(403)` if the token is fake or expired).
    - If everything is valid, it calls **`next()`** to hand over control to the next checkpoint on the conveyor belt.

#### 2. What is a Controller?
* **The Gate Agent / Flight Boarding Analogy:**
  - Once you pass all security checkpoints, you arrive at the gate. The gate agent checks your seat and boards you onto the plane.
  - The **Controller** is that gate agent. It is the function responsible for the **core business logic** of that endpoint.
  - It does the real work: talking to Mongoose models (`Account.findOne(...)`), executing database transactions, calculating new balances, and formatting the final HTTP response (`res.json(...)`).
* **In MVC Architecture (Model - View - Controller):**
  - **Model:** MongoDB / Mongoose (`User`, `Account`).
  - **View:** React frontend single-page application.
  - **Controller:** The Express handler function that coordinates between the Model and the View.

#### 3. How Middleware and Controllers Work Together in BrokeTM

```
Client (React App) sends: POST /api/v1/account/transfer
       │
       ▼
[ express.json() ]            <-- Middleware 1: Parses raw bytes into JS object (req.body)
       │ next()
       ▼
[ authMiddleware ]            <-- Middleware 2: Verifies Bearer JWT, sets req.userId
       │ next()
       ▼
[ Transfer Controller Handler ] <-- Controller: Opens session, checks balance, runs atomic transaction
       │
       ▼
Client receives: HTTP 200 { "message": "Transfer successful" }
```

### 💻 2. Codebase Anchors & Under the Hood
* **Zod Schemas (`backend/middlewares/middleware.js` lines 5–10, 75–78, 144–148):**
  ```javascript
  const userSchema = zod.object({
      username: zod.string().min(3).max(30).email(),
      firstName: zod.string().max(50),
      lastName: zod.string().max(50),
      password: zod.string().min(6),
  });

  const signinBody = zod.object({
      username: zod.string().email(),
      password: zod.string(),
  });
  ```
* **Authentication Route Guard (`backend/middlewares/middleware.js` lines 121–141):**
  ```javascript
  async function authMiddleware(req, res, next) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(403).json({ message: "Forbidden: Invalid token" });
      }

      const token = authHeader.split(' ')[1];
      try {
          const decoded = jwt.verify(token, JWT_SECRET);
          req.userId = decoded.userId;
          next();
      } catch (err) {
          return res.status(403).json({ message: 'Invalid or expired token' });
      }
  }
  ```

### 🛡️ 3. Failure Defense & Follow-up Questions

#### Q: "Why use Zod on the backend if you are already using Mongoose schemas?"
* **Spoken Defense:**
  > *"Mongoose schemas and Zod validation serve two fundamentally different purposes in the request lifecycle:
  > 
  > 1. **Fail-Fast Boundary Defense:** Zod runs at the HTTP controller/middleware layer. It validates the shape, type, and bounds of incoming JSON before any database connection or query is initiated. If someone sends an empty body or bad email, Zod rejects it in under 1 millisecond.
  > 2. **Mongoose is Database-Centric:** Mongoose validates data right before persisting it to MongoDB. If you rely solely on Mongoose, your server has already parsed the request, opened a database session, initiated a transaction, and queried the collection before discovering that the input is invalid.
  > 3. **Non-Persistent Payload Validation:** Many payloads never map directly to a database document—such as `/transfer` containing `{ to, amount }`. Mongoose has no schema for a transfer request! Zod provides runtime safety for transient business logic payloads."*
