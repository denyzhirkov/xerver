import { EventEmitter } from 'node:events';
import type * as net from 'node:net';
import { Protocol } from './Protocol';
import type { XerverMessage } from './types';

export class Connection extends EventEmitter {
  private socket: net.Socket;
  private buffer: Buffer = Buffer.alloc(0);
  public id: string | null = null; // Remote Node ID (name)
  public isHandshakeComplete: boolean = false;
  public remoteActions: string[] = [];
  public pendingRequests: number = 0; // Load Balancing: Active requests sent to this peer

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    this.setupSocket();
  }

  private setupSocket() {
    this.socket.setNoDelay(true); // Disable Nagle's algorithm for lower latency
    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      this.emit('close');
    });
  }

  private processBuffer() {
    const { messages, remaining } = Protocol.decode(this.buffer);
    this.buffer = remaining;
    messages.forEach((msg) => {
      this.emit('message', msg);
    });
  }

  public send(message: XerverMessage) {
    const data = Protocol.encode(message);
    this.socket.write(data);
  }

  /**
   * Cork the socket - buffer writes until uncork()
   * Useful for batching multiple messages into one TCP packet
   */
  public cork() {
    this.socket.cork();
  }

  /**
   * Uncork the socket - flush buffered writes
   */
  public uncork() {
    this.socket.uncork();
  }

  /**
   * Send multiple messages in a single TCP packet
   */
  public sendBatch(messages: XerverMessage[]) {
    if (messages.length === 0) return;
    if (messages.length === 1) {
      this.send(messages[0]);
      return;
    }
    
    this.socket.cork();
    for (const msg of messages) {
      const data = Protocol.encode(msg);
      this.socket.write(data);
    }
    // Use setImmediate to uncork on next tick, allowing more writes to batch
    setImmediate(() => this.socket.uncork());
  }

  public close() {
    this.socket.end();
  }
}
