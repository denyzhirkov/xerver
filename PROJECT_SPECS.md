# Xerver: Distributed Node.js Mesh Network

## 1. Overview
**Xerver** is a library for building nodes in a decentralized mesh network. Each node acts as both a server (accepting connections) and a client (connecting to peers). Nodes exchange capabilities (Actions) and route requests through each other, creating a unified computational space.

## 2. Technical Requirements
*   **Platform:** Node.js (Latest LTS).
*   **Core Module:** `net` (TCP Sockets).
*   **Data Format:** JSON (message serialization/deserialization).
*   **Architecture:** Event-driven, asynchronous.

## 3. Node Architecture (Class Xerver)

### 3.1. Constructor & Configuration
The node is initialized with a configuration object:
*   `name` (string): Unique node name within the local context (e.g., 'calculator').
*   `port` (number): Port for incoming TCP connections.
*   `nodes` (Optional Array): List of initial peers to connect to `[{ address: '...', port: ... }]`.
*   `requestTimeout` (number): Global timeout for action responses (default: 10000ms).
*   `maxConcurrency` (number): Maximum number of concurrent local actions (default: Infinity).
*   `onrequest` (function): Callback for monitoring request lifecycle events.

### 3.2. Main API Methods
*   `setAction(name, handler, options)`: Registers a local function.
    *   `name`: Action name (string).
    *   `handler`: Function `(args) => Promise<Result> | Result`.
    *   `options`: (Optional) `{ serializer: 'json' | 'msgpack' }`. Default is `'json'`.
*   `callAction(actionName, args)`: Calls an action (local or remote). Returns a `Promise`.
*   `start()`: Starts the TCP server and initiates connections to `nodes`.
*   `stop()`: Gracefully shuts down the server, closes peer connections, and clears pending requests.

### 3.3. Internal State
*   `peers`: Map of connected sockets (direct neighbors).
*   `actions`: Map of local functions.
*   `remoteActions`: Cache of actions provided by neighbors.
*   `pendingRequests`: Map storing `Promise`s for awaiting responses (`requestId` -> `{ resolve, reject, timer }`).

## 4. Interaction Protocol

Data exchange occurs via TCP. Messages are JSON objects. A length-prefixed framing strategy is used to split messages in the stream.

### 4.1. Message Types (Packet Structure)
```json
{
  "type": "HANDSHAKE" | "ACTION_CALL" | "ACTION_RESPONSE" | "ERROR",
  "id": "uuid-v4",
  "serializer": "json" | "msgpack", // Payload format
  "payload": { ... }, // Data encoded by the serializer
  "sender": "node-name",
  "trace": ["node1", "node2"] // To prevent cycles
}
```

### 4.2. Handshake Process
Upon connection establishment (incoming or outgoing):
1.  Nodes send `HANDSHAKE`.
2.  Payload contains: `name` of the node, list of available `localActions`.
3.  The node saves neighbor information and their capabilities.

### 4.3. Mesh Routing Mechanism
Logic for `callAction('sum', args)`:

1.  **Local Search:** If `sum` exists in `this.actions`, execute and return result.
2.  **Direct Peer Search:** If a neighbor `NodeB` is known to have `sum`, send request to it.
3.  **Mesh Propagation:**
    *   If the action location is unknown, flood to all neighbors.
    *   Request packet includes `trace` (list of visited nodes).
    *   A neighbor receiving the request checks `trace`. If present, ignore (cycle protection).
    *   If the neighbor doesn't have the action, it adds itself to `trace` and forwards to *its* neighbors.
4.  **Response Routing:** The response travels back through the request chain (using an internal routing table `RequestId -> IncomingConnection`).

## 5. Error Scenarios & Edge Cases
*   **Action Not Found:** If the request traverses the entire network (or TTL/MaxHops exceeded) and no one responds.
*   **Timeout:** If no response is received within `requestTimeout`.
*   **Disconnect:** If a node disconnects while waiting for a response, the request should be rejected.
*   **Duplicate Action Names:** First found wins strategy.

## 6. Roadmap (Completed)
1.  **Project Skeleton:** TypeScript setup.
2.  **Network Layer:** `Server` and `Client` wrappers over `net.Socket`. Stream parsing.
3.  **Protocol:** Message types and handlers.
4.  **Serialization:** JSON (default) and MsgPack support.
5.  **RPC Logic:** `callAction` with Promise support.
6.  **Mesh Logic:** Request forwarding and cycle detection.
7.  **Testing:** Integration tests with 3+ nodes, circular calls, large payloads.
8.  **Monitoring:** Request lifecycle hooks.
9.  **Concurrency Control:** Queue system for load management.
