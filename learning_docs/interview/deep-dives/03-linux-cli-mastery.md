# Deep Dive: Linux CLI, System Commands & Process Management

> **Core Focus:** Linux CLI Mastery, System Performance Inspection, Socket Debugging, Shell Scripting, and Signal Handling.

---

## 1. Process Architecture & Lifecycle in Linux

In Linux, every program executes as a process identified by a unique Process ID (`PID`).

### Key Inspection Commands
```bash
# 1. View full process tree with PIDs and arguments
ps aux | grep -E "node|mongod"

# 2. View process resource consumption sorted by memory
ps aux --sort=-%mem | head -n 10

# 3. Inspect real-time process threads and CPU spikes
top -p <PID> -H

# 4. View all file descriptors, network connections, and open files of a process
lsof -p <PID>
```

---

## 2. Network & Sockets Debugging (`ss` vs. `netstat`)

When Node.js fails to start with `Error: listen EADDRINUSE :::3000`:

```bash
# Modern Linux command to inspect listening sockets
ss -tulpn | grep 3000

# Legacy command
netstat -tulpn | grep 3000

# Find PID holding the port and kill it
lsof -i :3000 -t | xargs kill -15
```

### Explaining Flags for `ss -tulpn`:
- `-t`: Show TCP sockets.
- `-u`: Show UDP sockets.
- `-l`: Show only LISTENING sockets (ready to accept connections).
- `-p`: Show process name and PID owning the socket.
- `-n`: Numeric addresses (don't waste time resolving DNS names).

---

## 3. Linux Signals: Graceful Shutdown vs. Forceful Termination

When managing backend servers, understanding OS signals is crucial:

| Signal | Number | Name | Behavior in Node.js |
| :--- | :--- | :--- | :--- |
| `SIGINT` | 2 | Interrupt | Sent when pressing `Ctrl + C` in terminal. |
| `SIGTERM` | 15 | Terminate | Standard graceful shutdown signal sent by Docker and Kubernetes. Process can catch this signal, close database connections, finish pending HTTP requests, and exit cleanly. |
| `SIGKILL` | 9 | Kill | Non-catchable hard kill. The Linux kernel terminates the process immediately. Active file writes or database transactions may be corrupted. |
| `SIGHUP` | 1 | Hangup | Sent when terminal closes; often used to tell daemons to reload configuration files without restarting. |

### Graceful Shutdown in Node.js / Express
```javascript
const server = app.listen(3000);

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Starting graceful shutdown...');
    // 1. Stop accepting new HTTP requests
    server.close(async () => {
        console.log('HTTP server closed.');
        // 2. Close active database connections
        await mongoose.connection.close(false);
        console.log('MongoDB connection closed.');
        process.exit(0);
    });
});
```

---

## 4. Text Processing Power Tools: `grep`, `awk`, `sed`

Backend engineers must parse server logs quickly on remote production servers without a GUI.

```bash
# 1. Find all 500 error requests in access logs
grep " 500 " /var/log/nginx/access.log

# 2. Extract client IP addresses and count occurrences (Find DDoS attackers)
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head -n 10

# 3. Replace development DB host with production host across config files
sed -i 's/localhost:27017/prod-db.internal:27017/g' .env
```
