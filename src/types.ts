export interface XerverConfig {
  name: string;
  port: number;
  nodes?: PeerAddress[];
  requestTimeout?: number;
  maxConcurrency?: number; // New configuration option
  maxQueueSize?: number; // Limit the size of the request queue
  connectionRetryInterval?: number; // Time in ms to wait before reconnecting to a peer. Default: 5000
  streamBatching?: boolean; // Enable TCP batching for streaming (better for large payloads). Default: false
  onrequest?: RequestMonitorCallback;
}

export interface PeerAddress {
  address: string;
  port: number;
}

export type ActionHandler = (args: any) => Promise<any> | AsyncIterable<any> | any;

export interface ActionOptions {
  serializer?: 'json' | 'msgpack';
}

export interface ActionDefinition {
  handler: ActionHandler;
  options: ActionOptions;
}

export type MessageType =
  | 'HANDSHAKE'
  | 'ACTION_CALL'
  | 'ACTION_RESPONSE'
  | 'ACTION_STREAM_CHUNK' // New
  | 'ACTION_STREAM_END'   // New
  | 'ACTION_STREAM_ERROR' // New
  | 'ERROR';
export type SerializerType = 'json' | 'msgpack';

export interface XerverMessage<T = any> {
  type: MessageType;
  id: string;
  serializer: SerializerType;
  sender: string;
  trace: string[];
  payload: T;
}

export interface HandshakePayload {
  name: string;
  actions: string[];
}

export interface ActionCallPayload {
  action: string;
  args: any;
}

export interface ActionResponsePayload {
  result?: any;
  error?: string;
}

export interface StreamChunkPayload {
  chunk: any;
  index?: number; // Optional: TCP guarantees order
}

export interface RequestMonitorEvent {
  id: string;
  type: 'incoming' | 'outgoing' | 'forwarding' | 'local_execution' | 'queued' | 'stream_chunk'; // Added 'stream_chunk'
  action: string;
  sender?: string;
  target?: string;
  timestamp: number;
  metadata?: any;
}

export type RequestMonitorCallback = (event: RequestMonitorEvent) => void;
