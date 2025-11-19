import * as net from 'node:net';
import { decode, encode } from '@msgpack/msgpack';
import { v4 as uuidv4 } from 'uuid';
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

export class Xerver {
  readonly config: XerverConfig;
  readonly server: net.Server;
  readonly actions: Map<string, ActionDefinition> = new Map();
  readonly peers: Map<string, Connection> = new Map();
  readonly pendingRequests: Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      timer: NodeJS.Timeout;
    }
  > = new Map();
  private isRunning: boolean = false;
  private requestMonitor?: RequestMonitorCallback;

  // Concurrency Control
  private activeRequests: number = 0;
  private requestQueue: Array<() => void> = [];

  constructor(config: XerverConfig) {
    this.config = {
      requestTimeout: 10000,
      nodes: [],
      maxConcurrency: Infinity, // Default: unbounded
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
      this.emitMonitorEvent({
        id: requestId,
        type: 'queued',
        action: actionName,
        sender: sender,
      });

      await new Promise<void>((resolve) => {
        this.requestQueue.push(resolve);
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
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) next();
    }
  }

  public start() {
    if (this.isRunning) return;
    this.server.listen(this.config.port, () => {
      console.log(
        `Xerver node [${this.config.name}] listening on port ${this.config.port}`,
      );
      this.isRunning = true;
      this.connectToPeers();
    });
  }

  public async stop() {
    if (!this.isRunning) return;
    console.log(`Stopping Xerver node [${this.config.name}]...`);

    // 1. Close all peer connections
    for (const [, peer] of this.peers) {
      peer.close();
    }
    this.peers.clear();

    // 2. Clear pending requests
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('Node stopping'));
    }
    this.pendingRequests.clear();

    // 3. Clear queue
    this.requestQueue = [];
    this.activeRequests = 0;

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

  private handleIncomingConnection(socket: net.Socket) {
    const connection = new Connection(socket);
    this.setupConnection(connection);
  }

  private connectToPeers() {
    if (this.config.nodes) {
      this.config.nodes.forEach((peer) => {
        const socket = net.createConnection({
          host: peer.address,
          port: peer.port,
        });
        const connection = new Connection(socket);
        this.setupConnection(connection);
      });
    }
  }

  private setupConnection(connection: Connection) {
    connection.on('message', (msg: XerverMessage) =>
      this.handleMessage(connection, msg),
    );
    connection.on('close', () => {
      if (connection.id) {
        // console.log(`Peer disconnected: ${connection.id}`); // Optional log
        this.peers.delete(connection.id);
      }
    });
    connection.on('error', () => {
      // console.error(`Connection error:`, err); // Optional log
    });

    // Send Handshake
    const handshakeMsg: XerverMessage<HandshakePayload> = {
      type: 'HANDSHAKE',
      id: uuidv4(),
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
    let targetPeer: Connection | undefined;
    for (const peer of this.peers.values()) {
      if (peer.remoteActions.includes(actionName)) {
        targetPeer = peer;
        break;
      }
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
      this.forwardRequest(msg, targetPeer, connection);
    }
  }

  // Map to store where a request came from: RequestID -> IncomingConnection
  private routingTable: Map<string, Connection> = new Map();

  private routeRequest(
    msg: XerverMessage<ActionCallPayload>,
    incomingConnection: Connection,
  ) {
    // Store route
    this.routingTable.set(msg.id, incomingConnection);

    // Cleanup routing table after timeout
    setTimeout(() => {
      this.routingTable.delete(msg.id);
    }, this.config.requestTimeout);

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
    this.routingTable.set(msg.id, incoming);
    // Cleanup
    setTimeout(() => {
      this.routingTable.delete(msg.id);
    }, this.config.requestTimeout);

    const forwardedMsg = {
      ...msg,
      trace: [...msg.trace, this.config.name],
    };
    target.send(forwardedMsg);
  }

  private handleActionResponse(msg: XerverMessage<any>) {
    // 1. Check if we are the original requester
    if (this.pendingRequests.has(msg.id)) {
      const { resolve, reject, timer } = this.pendingRequests.get(msg.id)!;
      clearTimeout(timer);
      this.pendingRequests.delete(msg.id);

      if (msg.type === 'ERROR') {
        reject(new Error(msg.payload.error));
      } else {
        let result = msg.payload.result;
        if (msg.serializer === 'msgpack') {
          // Decode payload
          try {
            const buffer = Buffer.from(msg.payload, 'base64');
            const decoded: any = decode(buffer);
            result = decoded.result;
          } catch {
            reject(new Error('Failed to decode msgpack response'));
            return;
          }
        }
        resolve(result);
      }
      return;
    }

    // 2. If not, check routing table to forward back
    const sourceConnection = this.routingTable.get(msg.id);
    if (sourceConnection) {
      sourceConnection.send(msg);
      this.routingTable.delete(msg.id); // Request complete
    }
  }

  private remoteCall(actionName: string, args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();

      this.emitMonitorEvent({
        id: id,
        type: 'outgoing',
        action: actionName,
        target: 'mesh_search',
      });

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout calling action ${actionName}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const msg: XerverMessage<ActionCallPayload> = {
        type: 'ACTION_CALL',
        id,
        serializer: 'json',
        sender: this.config.name,
        trace: [this.config.name],
        payload: { action: actionName, args },
      };

      let targetPeer: Connection | undefined;
      for (const peer of this.peers.values()) {
        if (peer.remoteActions.includes(actionName)) {
          targetPeer = peer;
          break;
        }
      }

      if (targetPeer) {
        targetPeer.send(msg);
      } else {
        for (const peer of this.peers.values()) {
          peer.send(msg);
        }
      }
    });
  }
}
