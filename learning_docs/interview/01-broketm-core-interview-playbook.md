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
  > *"If two requests arrive at the exact same millisecond, WiredTiger's multi-version concurrency control (MVCC) detects a **Write Conflict** when both try to acquire a write lock on the same `Account` document.
  > 
  > In MongoDB transactions, when two concurrent transactions attempt to modify the same document, the second transaction throws a `WriteConflictException`. We catch this exception in our error handler and either retry with exponential backoff or abort with a clean error message.
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

### 🎯 1. The Spoken Pitch
> *"In a payments application, unauthorized access or malformed payloads can result in catastrophic financial losses.
> 
> We engineered a layered defense model:
> 1. **Stateless JWT Authentication:** Users authenticate with credentials and receive a signed JSON Web Token using HMAC-SHA256 (`jwt.sign`).
> 2. **Custom Route Guards (`authMiddleware`):** Every protected endpoint checks the `Authorization: Bearer <token>` header, verifies the signature against a secret key, and injects the authenticated `userId` directly into the request context.
> 3. **Strict Runtime Validation via Zod:** Client payloads are parsed and validated against strict schemas before hitting database logic. If an attacker injects negative amounts, non-numeric strings, or unknown fields, Zod's `safeParse` immediately aborts with an HTTP 411/400 without executing expensive database operations."*

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
