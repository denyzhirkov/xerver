# Xerver

**Xerver** is a lightweight, high-performance decentralized mesh network library for Node.js. It allows you to create nodes that can discover each other, share capabilities (Actions), and execute remote functions across a distributed network transparently.

Designed for speed and reliability, Xerver is capable of handling **40k+ RPS** with sub-millisecond latency.

## Features

*   **Mesh Networking:** Automatic request routing through connected peers.
*   **Streaming Support:** Real-time data streaming via `AsyncGenerator` (Server-to-Client).
*   **Zero-Config Discovery:** Nodes exchange capabilities via Handshake.
*   **Smart Load Balancing:** Uses **Least Connection** strategy to distribute tasks evenly across workers.
*   **Resilience:** Automatic reconnection with exponential backoff logic.
*   **High Performance:** 
    *   **Zero-Copy Queue:** Custom O(1) Linked-List Queue implementation.
    *   **Fast Serialization:** Protocol-agnostic, optimized for JSON and MsgPack (supports binary streams).
    *   **Low Latency:** Nagle's algorithm disabled for instant RPC execution.
    *   **HyperID:** High-speed UUID generation (50x faster than standard UUIDs).
*   **Cycle Detection:** Prevents infinite loops in the network graph.
*   **Concurrency Control:** Built-in queue to limit simultaneous local executions.
*   **Monitoring:** Hooks for logging and tracing requests.
*   **TypeScript:** Written in TypeScript with full type definitions.

## Installation

```bash
npm install xerver
```

## Quick Start

### 1. Create a Node (Worker)

```typescript
import { Xerver } from 'xerver';

const worker = new Xerver({
  name: 'worker-node',
  port: 3001,
});

// Register an action
worker.setAction('sum', (args: number[]) => {
  return args.reduce((a, b) => a + b, 0);
});

worker.start();
```

### 2. Create a Client Node

```typescript
import { Xerver } from 'xerver';

const client = new Xerver({
  name: 'client-node',
  port: 3002,
  // Connect to the worker
  nodes: [{ address: 'localhost', port: 3001 }], 
});

client.start();

// Wait for connection...
setTimeout(async () => {
  try {
    // Call the remote action 'sum'
    const result = await client.callAction('sum', [10, 20, 30]);
    console.log('Result:', result); // 60
  } catch (err) {
    console.error('RPC Error:', err);
  }
}, 1000);
```

## Advanced Usage

### Data Streaming
Transfer large datasets, real-time events, or binary files efficiently using async generators.

**Server:**
```typescript
node.setAction('generateNumbers', async function* (max: number) {
  for (let i = 0; i < max; i++) {
    yield i; // Send chunk to client
    await new Promise(r => setTimeout(r, 100));
  }
});
```

**Client:**
```typescript
for await (const num of client.callStream('generateNumbers', 10)) {
  console.log('Received:', num);
}
```

### Binary Streaming (High Performance)
For files or large buffers, use `msgpack` serializer. Xerver automatically optimizes chunk serialization.

```typescript
import * as fs from 'fs';

// Server: Stream a large file
node.setAction('downloadFile', async function* (path: string) {
  const stream = fs.createReadStream(path, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    yield chunk; // Yields Buffer
  }
}, { serializer: 'msgpack' });

// Client
const chunks = [];
for await (const chunk of client.callStream('downloadFile', 'video.mp4')) {
  chunks.push(chunk);
}
const file = Buffer.concat(chunks);
```

### Concurrency Limit
Protect your node from overload by limiting concurrent executions.

```typescript
const node = new Xerver({
  name: 'heavy-worker',
  port: 3003,
  maxConcurrency: 5 // Only 5 actions running at once
});
```

### Resilience & Auto-Reconnection
Configure automatic reconnection behavior.

```typescript
const node = new Xerver({
  name: 'resilient-node',
  port: 3005,
  nodes: [{ address: 'localhost', port: 3001 }],
  connectionRetryInterval: 5000 // Retry every 5 seconds if connection lost
});
```

### Worker Threads (CPU Bound Tasks)
Xerver is designed to be non-blocking. For CPU-intensive tasks, it is recommended to use a worker pool library like `piscina` inside your action handlers.

```typescript
import Piscina from 'piscina';

const pool = new Piscina({ filename: './worker.js' });

node.setAction('heavy-compute', async (args) => {
  // Offload to thread, keeping Xerver network loop free
  return await pool.run(args);
});
```

## API Reference

### `new Xerver(config)`
*   `config.name`: Unique name.
*   `config.port`: TCP port.
*   `config.nodes`: Array of peers to connect to `{ address, port }`.
*   `config.requestTimeout`: Timeout in ms (default 10000).
*   `config.maxConcurrency`: Max concurrent local jobs (default Infinity).
*   `config.maxQueueSize`: Max pending requests in queue (default 5000).
*   `config.connectionRetryInterval`: Reconnection interval in ms (default 5000).

### `setAction(name, handler, options)`
Registers a function available to the mesh.
*   `handler`: Can return a value, a Promise, or an AsyncGenerator (for streaming).
*   `options.serializer`: `'json'` (default) or `'msgpack'`.

### `callAction(name, args)`
Calls an action and returns a single result (Promise).

### `callStream(name, args)`
Calls an action and returns an AsyncGenerator for streaming results.

## License
ISC
