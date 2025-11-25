export interface XerverConfig {
  name: string;
  port: number;
  nodes?: PeerAddress[];
  requestTimeout?: number;
  maxConcurrency?: number; // New configuration option
  maxQueueSize?: number; // Limit the size of the request queue
  onrequest?: RequestMonitorCallback;
}

export interface PeerAddress {
  address: string;
  port: number;
}

export type ActionHandler = (args: any) => Promise<any> | any;

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

export interface RequestMonitorEvent {
  id: string;
  type: 'incoming' | 'outgoing' | 'forwarding' | 'local_execution' | 'queued'; // Added 'queued'
  action: string;
  sender?: string;
  target?: string;
  timestamp: number;
  metadata?: any;
}

export type RequestMonitorCallback = (event: RequestMonitorEvent) => void;
