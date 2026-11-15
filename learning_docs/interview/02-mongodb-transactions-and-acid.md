# MongoDB Multi-Document ACID Transactions & WiredTiger Internals

> **Job Description Alignment:**  
> *"Must have hands-on coding experience and strong practical knowledge of the MERN stack: Node.js, React.js, MongoDB, NestJS, Express.js... Strong focus on distributed back-end system design."*

---

## 1. The 30-Second Interview Pitch

> *"MongoDB is traditionally known as an eventually consistent document store, but since version 4.0, it supports full multi-document ACID transactions across replica sets using the WiredTiger storage engine.
> 
> In BrokeTM, peer-to-peer transfers require atomic dual-write operations: debiting account A and crediting account B. To guarantee ACID compliance:
> 1. We allocate a client session via `mongoose.startSession()`.
> 2. We execute both updates within a transaction snapshot using `session.startTransaction()`.
> 3. WiredTiger provides Snapshot Isolation: uncommitted writes are invisible to outside readers.
> 4. If any error occurs or balances are insufficient, `abortTransaction()` rolls back all uncommitted mutations.
> 5. Upon success, `commitTransaction()` writes the oplog with `w: "majority"` to prevent dirty reads or data loss upon replica failover."*

---

## 2. Plain English Analogy: The Dual-Lock Vault

Imagine an escrow officer standing between two private bank lockers:

* **Without Transactions (The Non-ACID Disaster):**
  1. The officer takes \$50 out of Alice's locker and puts it in his pocket.
  2. The building's power cuts out, or the officer suddenly has a heart attack.
  3. Bob's locker was never opened. Alice lost \$50, Bob got \$0, and the \$50 disappeared into the void.

* **With ACID Transactions (The Safe Way):**
  1. The officer places both Alice's and Bob's lockers into a temporary "Transaction Stage".
  2. He stages the \$50 debit for Alice and the \$50 credit for Bob.
  3. Neither change is permanent or visible to anyone else in the bank.
  4. Only when **both** keys turn simultaneously does the transaction seal (**Commit**).
  5. If anything goes wrong midway (Bob's locker is frozen, Alice's balance is insufficient, or a power glitch occurs), the entire staging area resets (**Rollback**).

---

## 3. The 4 Pillars of ACID in MongoDB

| ACID Property | What it Means in BrokeTM | MongoDB / WiredTiger Implementation |
| :--- | :--- | :--- |
| **Atomicity** | Either both accounts are updated (debit + credit) or neither is. | WiredTiger journals transactions in memory; changes are written to the Oplog atomically on commit. |
| **Consistency** | Total money in the system remains conserved. No balance drops below \$0. | Schema checks and application-level invariant validation before committing transactions. |
| **Isolation** | Outside queries cannot see intermediate states (e.g., Alice debited but Bob not yet credited). | **Snapshot Isolation**: Readers see the snapshot of data as it existed before the transaction started. |
| **Durability** | Once committed, funds remain transferred even if the database crashes 1 millisecond later. | Write Concern `w: "majority"` ensures the transaction is committed to the Write-Ahead Log (WAL / Oplog) on disk across replica nodes. |

---

## 4. Under the Hood in BrokeTM

Look at `backend/routes/account.js` (lines 68–110):

```javascript
router.post('/transfer', authMiddleware, async (req, res) => {
    // 1. Allocate a client session from the connection pool
    const session = await mongoose.startSession();

    try {
        // 2. Start the transaction
        session.startTransaction({
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' }
        });

        const { amount, to } = req.body;

        // 3. Query sender account bound to this session
        const account = await Account.findOne({ userId: req.body.userId }).session(session);

        if (!account || account.balance < amount) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        // 4. Query recipient account bound to this session
        const toAccount = await Account.findOne({ userId: to }).session(session);

        if (!toAccount) {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Invalid account' });
        }

        // 5. Atomic mutations using $inc
        await Account.updateOne(
            { userId: req.body.userId },
            { $inc: { balance: -amount } }
        ).session(session);

        await Account.updateOne(
            { userId: to },
            { $inc: { balance: amount } }
        ).session(session);

        // 6. Commit the transaction across the replica set
        await session.commitTransaction();
        res.json({ message: 'Transfer successful' });

    } catch (error) {
        // 7. Rollback on any unexpected database error
        await session.abortTransaction();
        res.status(500).json({ message: 'Transaction aborted due to server error' });
    } finally {
        // 8. Always release the session back to the pool
        session.endSession();
    }
});
```

---

## 5. WiredTiger Concurrency & Write Conflicts

### How WiredTiger Handles Lock Contention
* Unlike traditional RDBMS that may use coarse table-level or row-level pessimistic locks (`SELECT ... FOR UPDATE`), MongoDB's WiredTiger engine uses **Optimistic Concurrency Control (OCC)** at the document level.
* When a transaction begins, WiredTiger gives it a point-in-time snapshot.
* When the transaction writes to a document, WiredTiger checks if any other transaction has modified that document since the snapshot timestamp.
* If another concurrent transaction modified the same document first:
  - MongoDB throws a `WriteConflictException` (Error code `112`).
  - The transaction cannot commit and must either abort or retry.

### Retry Logic (Production Best Practice)
In production high-concurrency payment engines, transient transaction errors should be automatically retried with exponential backoff:

```javascript
async function executeWithRetry(txnFn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            const result = await txnFn(session);
            await session.commitTransaction();
            return result;
        } catch (error) {
            await session.abortTransaction();
            const isTransient = error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError');
            if (isTransient && attempt < maxRetries) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 50));
                continue;
            }
            throw error;
        } finally {
            session.endSession();
        }
    }
}
```

---

## 6. Common Interviewer Traps & Counter-Defenses

### Trap 1: "Why use MongoDB for transactions instead of PostgreSQL?"
* **Counter-Defense:**
  > *"PostgreSQL is traditionally the gold standard for relational ACID workloads, and in Bionexa we utilized PostgreSQL for that exact reason.
  > 
  > However, in BrokeTM we demonstrated that modern MongoDB (4.4+) provides full multi-document ACID transactions via WiredTiger when configured with a Replica Set. MongoDB allows polymorphic document modeling and horizontal sharding, while still providing snapshot isolation and majority write guarantees when financial transactions are strictly necessary.
  > 
  > Knowing both PostgreSQL (relational locking, foreign keys, row-level locks) and MongoDB (document snapshots, oplog replication, Mongoose sessions) allows us to choose the right persistence layer based on system requirements."*

### Trap 2: "What is the maximum duration of a MongoDB transaction?"
* **Counter-Defense:**
  > *"By default, MongoDB transactions have a lifetime limit of **60 seconds** (`transactionLifetimeLimitSeconds`). If a transaction remains open longer than 60 seconds, the transaction coordinator aborts it automatically to prevent uncommitted snapshot data from overflowing the WiredTiger cache and pinning the oplog."*
