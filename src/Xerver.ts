import * as net from 'node:net';
import { decode, encode } from '@msgpack/msgpack';
import hyperid from 'hyperid';
import { Queue } from './Queue';
import { Connection } from './Connection';
import type {
  ActionCallPayload,
  ActionDefinition,
  ActionHandler,
  ActionOptions,
  ActionResponsePayload,
  HandshakePayload,
  RequestMonitorCallback,
  RequestMonitorEvent,
  XerverConfig,
  XerverMessage,
} from './types';

const uuid = hyperid();

export class Xerver {
  readonly config: XerverConfig;
  readonly server: net.Server;
  readonly actions: Map<string, ActionDefinition> = new Map();
  readonly peers: Map<string, Connection> = new Map();

  // Optimized: Store timestamp instead of individual timers
  readonly pendingRequests: Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      createdAt: number;
      actionName: string;
      peerId?: string; // Track which peer is handling this request
    }
  > = new Map();

  private isRunning: boolean = false;
  private requestMonitor?: RequestMonitorCallback;
  private cleanupTimer?: NodeJS.Timeout;

  // Concurrency Control
  private activeRequests: number = 0;
  private requestQueue: Queue<{
    resolve: () => void;
    reject: (err: any) => void;
  }> = new Queue();

  constructor(config: XerverConfig) {
    this.config = {
      requestTimeout: 10000,
      nodes: [],
      maxConcurrency: Infinity, // Default: unbounded
      maxQueueSize: 5000, // Default queue limit
      connectionRetryInterval: 5000, // Default: 5s
      ...config,
    };
    this.requestMonitor = config.onrequest;
    this.server = net.createServer((socket) =>
      this.handleIncomingConnection(socket),
    );
  }

  public setAction(
    name: string,
    handler: ActionHandler,
    options: ActionOptions = { serializer: 'json' },
  ) {
    this.actions.set(name, { handler, options });
  }

  public setRequestMonitor(callback: RequestMonitorCallback) {
    this.requestMonitor = callback;
  }

  private emitMonitorEvent(event: Omit<RequestMonitorEvent, 'timestamp'>) {
    if (this.requestMonitor) {
      this.requestMonitor({
        ...event,
        timestamp: Date.now(),
      });
    }
  }

  public async callAction(actionName: string, args: any): Promise<any> {
    if (!this.isRunning) {
      throw new Error('Xerver is not running');
    }

    this.emitMonitorEvent({
      id: 'local-init',
      type: 'outgoing',
      action: actionName,
      target: 'unknown',
    });

    const action = this.actions.get(actionName);
    if (action) {
      // Local execution
      return this.executeLocalAction(action, actionName, args, 'local-init');
    }

    // Remote execution
    return this.remoteCall(actionName, args);
  }

  private async executeLocalAction(
    action: ActionDefinition,
    actionName: string,
    args: any,
    requestId: string,
    sender?: string,
  ): Promise<any> {
    // Check concurrency limit
    const maxConcurrency = this.config.maxConcurrency || Infinity;

    if (this.activeRequests >= maxConcurrency) {
      // Check Queue Limit
      if (this.requestQueue.size >= (this.config.maxQueueSize || 5000)) {
        this.emitMonitorEvent({
          id: requestId,
          type: 'queued',
          action: actionName,
          sender: sender,
          metadata: { reason: 'Queue full' }
        });
        throw new Error('Service Unavailable: Request queue full');
      }

      this.emitMonitorEvent({
        id: requestId,
        type: 'queued',
        action: actionName,
        sender: sender,
      });

      await new Promise<void>((resolve, reject) => {
        this.requestQueue.enqueue({ resolve, reject });
      });
    }

    this.activeRequests++;
    this.emitMonitorEvent({
      id: requestId,
      type: 'local_execution',
      action: actionName,
      sender: sender,
    });

    try {
      return await action.handler(args);
    } finally {
      this.activeRequests--;
      this.processQueue();
    }
  }

  private processQueue() {
    if (this.requestQueue.size > 0) {
      const next = this.requestQueue.dequeue();
      if (next) {
        // Optimization: Use setImmediate to allow I/O between queued tasks
        setImmediate(next.resolve);
      }
    }
  }

  public start(): Promise<void> {
    if (this.isRunning) return Promise.resolve();
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        console.log(
          `Xerver node [${this.config.name}] listening on port ${this.config.port}`,
        );
        this.isRunning = true;
        this.startCleanupTimer();
        this.connectToPeers();
        resolve();
      });
    });
  }

  public async stop() {
    if (!this.isRunning) return;
    console.log(`Stopping Xerver node [${this.config.name}]...`);

    this.stopCleanupTimer();

    // 1. Close all peer connections
    for (const [, peer] of this.peers) {
      peer.close();
    }
    this.peers.clear();

    // 2. Clear pending requests
    for (const [, req] of this.pendingRequests) {
      req.reject(new Error('Node stopping'));
    }
    this.pendingRequests.clear();

    // 3. Clear queue and reject pending queued items
    // yocto-queue is iterable in newer versions, but safe way is dequeue loop
    while (this.requestQueue.size > 0) {
      const req = this.requestQueue.dequeue();
      req?.reject(new Error('Node stopping'));
    }
    this.activeRequests = 0;
    this.routingTable.clear();

    // 4. Close server
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          console.error(`Error stopping server ${this.config.name}:`, err);
          reject(err);
        } else {
          console.log(`Xerver node [${this.config.name}] stopped.`);
          this.isRunning = false;
          resolve();
        }
      });
    });
  }

  // --- Timeout Management ---

  private startCleanupTimer() {
    if (this.cleanupTimer) return;
    // Run cleanup every 1s
    this.cleanupTimer = setInterval(() => this.cleanupStaleRequests(), 1000);
    this.cleanupTimer.unref(); // Don't keep process alive just for this
  }

  private stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private cleanupStaleRequests() {
    const now = Date.now();
    const timeout = this.config.requestTimeout || 10000;

    // 1. Cleanup Pending Requests (Outgoing)
    for (const [id, req] of this.pendingRequests) {
      if (now - req.createdAt > timeout) {
        // Use original error message format to maintain compatibility
        req.reject(new Error(`Timeout calling action ${req.actionName}`));

        // Decrease pending requests on peer
        if (req.peerId) {
          const peer = this.peers.get(req.peerId);
          if (peer) {
            peer.pendingRequests = Math.max(0, peer.pendingRequests - 1);
          }
        }

        this.pendingRequests.delete(id);
      }
    }

    // 2. Cleanup Routing Table (Forwarding)
    for (const [id, route] of this.routingTable) {
      if (now - route.createdAt > timeout) {
        this.routingTable.delete(id);
      }
    }
  }

  private handleIncomingConnection(socket: net.Socket) {
    const connection = new Connection(socket);
    this.setupConnection(connection);
  }

  private connectToPeers() {
    if (this.config.nodes) {
      this.config.nodes.forEach((peer) => {
        this.connectToPeer(peer);
      });
    }
  }

  private connectToPeer(peer: { address: string; port: number }) {
    if (!this.isRunning) return;

    const socket = net.createConnection({
      host: peer.address,
      port: peer.port,
    });

    const connection = new Connection(socket);

    // Silence initial connection errors; we rely on 'close' to retry
    socket.on('error', () => { });

    socket.on('close', () => {
      // If node is still running and reconnection is enabled
      if (this.isRunning && (this.config.connectionRetryInterval ?? 0) > 0) {
        const retryDelay = this.config.connectionRetryInterval!;
        // Only log if we had a successful handshake or if debug is on? 
        // For now, console.log might be too noisy if target is down for long.
        // Let's keep it minimal or use debug level if we had one.
        // console.log(`[${this.config.name}] Connection to ${peer.address}:${peer.port} closed. Retrying in ${retryDelay}ms...`);

        setTimeout(() => this.connectToPeer(peer), retryDelay);
      }
    });

    this.setupConnection(connection);
  }

  private setupConnection(connection: Connection) {
    connection.on('message', (msg: XerverMessage) =>
      this.handleMessage(connection, msg),
    );
    connection.on('close', () => {
      if (connection.id) {
        this.peers.delete(connection.id);
      }
      // Cleanup resources associated with this connection if necessary
    });
    connection.on('error', () => {
      // Socket errors are handled by close mostly, but good to have listener
    });

    // Send Handshake
    const handshakeMsg: XerverMessage<HandshakePayload> = {
      type: 'HANDSHAKE',
      id: uuid(),
      serializer: 'json',
      sender: this.config.name,
      trace: [this.config.name],
      payload: {
        name: this.config.name,
        actions: Array.from(this.actions.keys()),
      },
    };
    connection.send(handshakeMsg);
  }

  private handleMessage(connection: Connection, msg: XerverMessage) {
    switch (msg.type) {
      case 'HANDSHAKE':
        this.handleHandshake(connection, msg);
        break;
      case 'ACTION_CALL':
        this.handleActionCall(connection, msg);
        break;
      case 'ACTION_RESPONSE':
      case 'ERROR':
        this.handleActionResponse(msg);
        break;
    }
  }

  private handleHandshake(
    connection: Connection,
    msg: XerverMessage<HandshakePayload>,
  ) {
    const { name, actions } = msg.payload;
    console.log(`[${this.config.name}] Handshake received from ${name}`);
    connection.id = name;
    connection.isHandshakeComplete = true;
    connection.remoteActions = actions;
    this.peers.set(name, connection);
  }

  private async handleActionCall(
    connection: Connection,
    msg: XerverMessage<ActionCallPayload>,
  ) {
    const { action: actionName, args } = msg.payload;

    this.emitMonitorEvent({
      id: msg.id,
      type: 'incoming',
      action: actionName,
      sender: msg.sender,
      metadata: { trace: msg.trace },
    });

    // Check for cycles
    if (msg.trace.includes(this.config.name)) {
      console.warn(
        `Cycle detected for action ${actionName}, trace: ${msg.trace.join('->')}`,
      );
      return;
    }

    // 1. Local Execution
    const localAction = this.actions.get(actionName);
    if (localAction) {
      try {
        const result = await this.executeLocalAction(
          localAction,
          actionName,
          args,
          msg.id,
          msg.sender,
        );

        const serializer = localAction.options.serializer || 'json';

        let payload: any = { result };
        if (serializer === 'msgpack') {
          const encoded = encode(payload);
          payload = Buffer.from(encoded).toString('base64');
        }

        const response: XerverMessage<any> = {
          type: 'ACTION_RESPONSE',
          id: msg.id,
          serializer: serializer,
          sender: this.config.name,
          trace: [...msg.trace, this.config.name],
          payload: payload,
        };
        connection.send(response);
      } catch (error: any) {
        const errorMsg: XerverMessage<ActionResponsePayload> = {
          type: 'ERROR',
          id: msg.id,
          serializer: 'json',
          sender: this.config.name,
          trace: [...msg.trace, this.config.name],
          payload: { error: error.message || 'Unknown error' },
        };
        connection.send(errorMsg);
      }
      return;
    }

    // 2. Forwarding (Mesh)
    // Load Balancing: Least Connection
    const candidates: Connection[] = [];
    for (const peer of this.peers.values()) {
      if (peer.remoteActions.includes(actionName)) {
        candidates.push(peer);
      }
    }

    let targetPeer: Connection | undefined;
    if (candidates.length > 0) {
      // Sort by pendingRequests (Ascending)
      candidates.sort((a, b) => a.pendingRequests - b.pendingRequests);
      targetPeer = candidates[0];
    }

    this.emitMonitorEvent({
      id: msg.id,
      type: 'forwarding',
      action: actionName,
      target: targetPeer?.id || 'flood',
    });

    if (!targetPeer) {
      this.routeRequest(msg, connection);
    } else {
      // Track forwarded request load?
      // Note: For simple forwarding we don't typically count 'pendingRequests' on Connection
      // because we are not the original requester waiting for response.
      // However, if we want to load balance properly in mesh, we should probably track it.
      // But currently pendingRequests is tied to 'this.pendingRequests' map which is for OUR requests.
      // For now, we only load balance outgoing requests originating from here or simple forwarding.

      // If we forward, we don't track response here (it goes via route table). 
      // So we can't easily decrement count when response passes through. 
      // True Least Connection in mesh requires gossip protocol.
      // Current implementation: Least Connection for DIRECT neighbors.
      this.forwardRequest(msg, targetPeer, connection);
    }
  }

  // Map to store where a request came from: RequestID -> IncomingConnection
  // Optimized: Store creation time for cleanup
  private routingTable: Map<string, { connection: Connection; createdAt: number }> = new Map();

  private routeRequest(
    msg: XerverMessage<ActionCallPayload>,
    incomingConnection: Connection,
  ) {
    // Store route with timestamp
    this.routingTable.set(msg.id, {
      connection: incomingConnection,
      createdAt: Date.now()
    });

    // Forward to all applicable peers
    const nextTrace = [...msg.trace, this.config.name];

    for (const peer of this.peers.values()) {
      // Don't send back to sender
      if (peer === incomingConnection) continue;
      // Don't send to nodes in trace
      if (peer.id && msg.trace.includes(peer.id)) continue;

      const forwardedMsg = { ...msg, trace: nextTrace };
      peer.send(forwardedMsg);
    }
  }

  private forwardRequest(
    msg: XerverMessage,
    target: Connection,
    incoming: Connection,
  ) {
    this.routingTable.set(msg.id, {
      connection: incoming,
      createdAt: Date.now()
    });

    const forwardedMsg = {
      ...msg,
      trace: [...msg.trace, this.config.name],
    };
    target.send(forwardedMsg);
  }

  private handleActionResponse(msg: XerverMessage<any>) {
    // 1. Check if we are the original requester
    if (this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      // Decrease load count for the peer that handled this
      if (req.peerId) {
        const peer = this.peers.get(req.peerId);
        if (peer) {
          peer.pendingRequests = Math.max(0, peer.pendingRequests - 1);
        }
      }

      if (msg.type === 'ERROR') {
        req.reject(new Error(msg.payload.error));
      } else {
        let result = msg.payload.result;
        if (msg.serializer === 'msgpack') {
          // Decode payload
          try {
            const buffer = Buffer.from(msg.payload, 'base64');
            const decoded: any = decode(buffer);
            result = decoded.result;
          } catch {
            req.reject(new Error('Failed to decode msgpack response'));
            return;
          }
        }
        req.resolve(result);
      }
      return;
    }

    // 2. If not, check routing table to forward back
    const route = this.routingTable.get(msg.id);
    if (route) {
      route.connection.send(msg);
      this.routingTable.delete(msg.id); // Request complete
    }
  }

  private remoteCall(actionName: string, args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = uuid();

      // Load Balancing: Least Connection
      // 1. Find candidates
      const candidates: Connection[] = [];
      for (const peer of this.peers.values()) {
        if (peer.remoteActions.includes(actionName)) {
          candidates.push(peer);
        }
      }

      let targetPeer: Connection | undefined;
      if (candidates.length > 0) {
        // 2. Sort by pendingRequests (Ascending)
        candidates.sort((a, b) => a.pendingRequests - b.pendingRequests);
        targetPeer = candidates[0];
      }

      this.emitMonitorEvent({
        id: id,
        type: 'outgoing',
        action: actionName,
        target: targetPeer?.id || 'mesh_search',
      });

      // Optimized: No setTimeout here. Cleanup handled by cleanupStaleRequests
      this.pendingRequests.set(id, {
        resolve,
        reject,
        createdAt: Date.now(),
        actionName,
        peerId: targetPeer?.id || undefined // Store peer ID for load tracking
      });

      const msg: XerverMessage<ActionCallPayload> = {
        type: 'ACTION_CALL',
        id,
        serializer: 'json',
        sender: this.config.name,
        trace: [this.config.name],
        payload: { action: actionName, args },
      };

      if (targetPeer) {
        targetPeer.pendingRequests++; // Increment load
        targetPeer.send(msg);
      } else {
        for (const peer of this.peers.values()) {
          peer.send(msg);
        }
      }
    });
  }
}
