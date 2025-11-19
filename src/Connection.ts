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

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    this.setupSocket();
  }

  private setupSocket() {
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

  public close() {
    this.socket.end();
  }
}
