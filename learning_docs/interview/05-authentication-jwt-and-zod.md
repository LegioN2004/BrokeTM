# Authentication, JWT Lifecycle & Zod Schema Validation

> **Job Description Alignment:**  
> *"Must have hands-on coding experience and strong practical knowledge of the MERN stack: Node.js, Express.js... NestJS... Experience using GitHub or Bitbucket for version control and collaboration."*

---

## 1. The 30-Second Interview Pitch

> *"In BrokeTM, security and data integrity are enforced at the HTTP boundary before any financial logic runs.
> 
> We implemented a two-pillar defensive strategy:
> 1. **Stateless JWT Authentication:** We issue signed JSON Web Tokens using HMAC-SHA256 upon login/signup. Protected endpoints are guarded by `authMiddleware`, which strips the Bearer prefix, verifies token cryptographic integrity against our server secret, and injects the authenticated `userId` into `req.userId`.
> 2. **Strict Runtime Schema Validation via Zod:** Client-submitted payloads are validated with Zod schemas (`safeParse`) at the controller layer. If an input contains extra malicious fields, malformed emails, negative amounts, or non-string passwords, the request is rejected immediately with HTTP 411/400 without touching the database or triggering session allocations."*

---

## 2. JWT Architecture & Lifecycle

### How JSON Web Tokens Work
A JWT consists of 3 Base64URL-encoded strings separated by dots:
$$\text{Header} \,.\, \text{Payload} \,.\, \text{Signature}$$

1. **Header:** Algorithm and token type (`{ "alg": "HS256", "typ": "JWT" }`).
2. **Payload:** Claims and user identifiers (`{ "userId": "665f...", "iat": 1717..., "exp": 1718... }`).
3. **Signature:** Calculated by hashing Header + Payload with the server's private secret:
   $$\text{HMACSHA256}(\text{base64UrlEncode}(\text{header}) + "." + \text{base64UrlEncode}(\text{payload}), \text{secret})$$

### 💻 Codebase Implementation in BrokeTM

#### 1. Token Issuance (`backend/routes/user.js` lines 17–22):
```javascript
const jwtToken = jwt.sign(
    {
        userId: user._id,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
);
```

#### 2. Route Guard Middleware (`backend/middlewares/middleware.js` lines 121–141):
```javascript
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    
    // 1. Guard against missing or malformed header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).json({
            message: "Forbidden: Invalid token, or token doesn't exist"
        });
    }

    // 2. Extract raw token string
    const token = authHeader.split(' ')[1];

    try {
        // 3. Verify cryptographic signature and expiration
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 4. Attach verified userId to request context
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(403).json({
            message: 'Invalid or expired session token'
        });
    }
}
```

---

## 3. Zod Runtime Validation: Why TypeScript Isn't Enough

A common question interviewers love to ask:  
*"If you write your backend in TypeScript, why do you need Zod?"*

### The Spoken Answer
> *"TypeScript only exists at **compile time**. Once the code is compiled to JavaScript and runs in Node.js, all types, interfaces, and generics are completely erased.
> 
> When an external client sends an HTTP `POST` with a JSON body:
> - TypeScript cannot verify what is actually inside `req.body` at runtime.
> - An attacker can send `{ amount: -500 }`, `{ amount: "drop database" }`, or omit required fields entirely.
> 
> Zod provides **runtime schema validation**. It parses the raw untrusted input in production, checks types, lengths, regex formats, and bounds, strips out dangerous undeclared properties, and infers strictly typed TypeScript objects simultaneously."*

### 💻 Zod Schemas in BrokeTM (`backend/middlewares/middleware.js`):

```javascript
const zod = require('zod');

// User Registration Validation
const userSchema = zod.object({
    username: zod.string().min(3).max(30).email(),
    firstName: zod.string().max(50),
    lastName: zod.string().max(50),
    password: zod.string().min(6),
});

// User Signin Validation
const signinBody = zod.object({
    username: zod.string().email(),
    password: zod.string().min(1),
});

// Transfer Payload Validation (Production Enhancement)
const transferBody = zod.object({
    to: zod.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ObjectId"),
    amount: zod.number().positive("Amount must be greater than zero"),
});
```

---

## 4. Production Security Enhancements: Password Hashing

In production systems, passwords must **never** be stored in plaintext. 

### Bcrypt Password Hashing Flow
* In modern backend security, passwords should be hashed using `bcrypt` or `argon2` before persisting:
```javascript
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

// Before saving user:
const hashedPassword = await bcrypt.hash(rawPassword, SALT_ROUNDS);

// On sign-in:
const isMatch = await bcrypt.compare(inputPassword, user.password);
```

### Why Salt and Pepper?
* **Salt:** Random bytes prepended to the password before hashing. Prevents attackers from using precomputed **Rainbow Tables** to crack passwords.
* **Cost Factor (Rounds):** Adjusts the computational work required to calculate the hash, making brute-force attacks computationally prohibitive.

---

## 5. Security Checklist for Financial APIs

| Security Threat | Attack Vector | BrokeTM Defense Mechanism |
| :--- | :--- | :--- |
| **Token Tampering** | Attacker changes `userId` in payload to steal another user's balance. | `jwt.verify()` recalculates HMAC-SHA256 signature; fails immediately if a single byte was altered. |
| **Negative Transfer Amount** | Attacker transfers `-$100`, effectively stealing \$100 from recipient. | Zod `zod.number().positive()` rejects negative numbers before transaction logic runs. |
| **Insecure Direct Object Reference (IDOR)** | Attacker queries `/balance` with another user's ID. | `authMiddleware` injects `req.userId` directly from the verified JWT payload; the client cannot specify someone else's ID. |
| **NoSQL Injection** | Attacker submits `{ "$gt": "" }` in username field. | Zod forces input to be of type `string`, neutralizing MongoDB query operator injection. |
