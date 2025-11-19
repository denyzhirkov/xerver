# Xerver

**Xerver** is a lightweight, decentralized mesh network library for Node.js. It allows you to create nodes that can discover each other, share capabilities (Actions), and execute remote functions across a distributed network transparently.

## Features

*   **Mesh Networking:** Automatic request routing through connected peers.
*   **Zero-Config Discovery:** Nodes exchange capabilities via Handshake.
*   **Protocol Agnostic Serialization:** Support for JSON and MsgPack (for binary data).
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

### Binary Data with MsgPack
Use `msgpack` serializer for efficient binary transfer (e.g., buffers, images).

```typescript
// Server
node.setAction('processImage', (buffer: Buffer) => {
  return { size: buffer.length, status: 'processed' };
}, { serializer: 'msgpack' });

// Client
const result = await node.callAction('processImage', fs.readFileSync('image.png'));
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

### Monitoring
Log all incoming and outgoing requests.

```typescript
const node = new Xerver({
  name: 'monitored-node',
  port: 3004,
  onrequest: (event) => {
    console.log(`[${event.timestamp}] ${event.type}: ${event.action} (ID: ${event.id})`);
  }
});
```

## API Reference

### `new Xerver(config)`
*   `config.name`: Unique name.
*   `config.port`: TCP port.
*   `config.nodes`: Array of peers to connect to `{ address, port }`.
*   `config.requestTimeout`: Timeout in ms (default 10000).
*   `config.maxConcurrency`: Max concurrent local jobs (default Infinity).

### `setAction(name, handler, options)`
Registers a function available to the mesh.
*   `options.serializer`: `'json'` (default) or `'msgpack'`.

### `callAction(name, args)`
Calls an action. Finds it locally or routes request through the mesh. Returns a `Promise`.

## License
ISC

