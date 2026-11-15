# Deep Dive: Double-Entry Bookkeeping & Immutable Financial Ledgers

> **Core Focus:** Financial System Design, Accounting Invariants, Immutable Ledgers, Audit Trails, and Balance Reconciliation.

---

## 1. Why Mutable Balance Columns Fail at Scale

In BrokeTM's MVP, balances are stored as a mutable number:
```javascript
const accountSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    balance: { type: Number, required: true }
});
```

### The Problem with Mutable Balances in Enterprise Banking:
1. **Destructive Updates:** An `UPDATE accounts SET balance = 500` overwrites the past. If the balance changes from \$1,000 to \$500, you have no record of *why* it changed or who initiated it.
2. **Untraceable Drift:** If a race condition or bug corrupts the balance column, it is mathematically impossible to reconstruct what the true balance should be.
3. **Audit Failure:** Financial auditors require an immutable, append-only paper trail for every single cent moved.

---

## 2. The Solution: Double-Entry Bookkeeping

In modern fintech (e.g., Stripe, PayPal, Square), account balances are **never** mutated directly. Instead, balances are derived from an immutable journal of **Double-Entry Transactions**.

### The Golden Rule of Accounting:
$$\sum \text{Debits} = \sum \text{Credits}$$

For every money movement:
- One account is **Debited**.
- Another account is **Credited**.
- The net balance change across the universe is **strictly zero**.

---

## 3. Production Ledger Schema Architecture

```javascript
// 1. Transaction Header (The Event)
const TransactionSchema = new mongoose.Schema({
    transactionId: { type: String, unique: true, required: true }, // UUID v4
    idempotencyKey: { type: String, unique: true, required: true },
    type: { type: String, enum: ['P2P_TRANSFER', 'DEPOSIT', 'WITHDRAWAL'] },
    status: { type: String, enum: ['PENDING', 'POSTED', 'VOIDED'] },
    createdAt: { type: Date, default: Date.now }
});

// 2. Journal Entry Line Items (The Immutable Entries)
const JournalEntrySchema = new mongoose.Schema({
    transactionId: { type: String, required: true, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    direction: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
    amount: { type: Number, required: true, min: 1 }, // Stored in cents (integer)
    currency: { type: String, default: 'USD' },
    postedAt: { type: Date, default: Date.now }
});
```

### Example: Alice Transfers \$50 to Bob

| Line Item | Account | Direction | Amount (cents) |
| :--- | :--- | :--- | :--- |
| **Line 1** | Alice's Account | `DEBIT` | 5000 |
| **Line 2** | Bob's Account | `CREDIT` | 5000 |

* **Total Debits:** \$50.00
* **Total Credits:** \$50.00
* **Net Invariant:** $\$50.00 - \$50.00 = 0$ (Balanced!)

---

## 4. High-Performance Balance Derivation: Snapshots + Deltas

If an account has 100,000 transactions, querying `SUM(credits) - SUM(debits)` on every request is too slow ($O(N)$ query).

### The Solution: Snapshot Cache
1. We maintain a read-optimized cached balance document:
   ```javascript
   {
       accountId: ObjectId("..."),
       cachedBalance: 45000,
       lastSnapshotAt: ISODate("2026-11-15T00:00:00Z"),
       lastJournalId: ObjectId("...")
   }
   ```
2. When querying a live balance:
   $$\text{Current Balance} = \text{cachedBalance} + \sum \text{Journal Entries posted after } \text{lastSnapshotAt}$$
3. A nightly reconciliation worker checks:
   $$\text{cachedBalance} \stackrel{?}{=} \sum_{\text{all time}} (\text{Credits} - \text{Debits})$$
   If any discrepancy is detected, an alert triggers for manual review.
