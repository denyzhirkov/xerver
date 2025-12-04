import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as crypto from 'node:crypto';
import { Xerver } from '../../src/Xerver';

// Helper: Wait for connections
const waitForConnection = (node: Xerver, peerName: string) => {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (node.peers.has(peerName)) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
};

describe('Xerver Streaming Tests', () => {
  describe('Should stream data from Server to Client', () => {
    let server: Xerver;
    let client: Xerver;

    beforeAll(async () => {
      server = new Xerver({ name: 'stream-server', port: 13001 });
      client = new Xerver({
        name: 'stream-client',
        port: 13002,
        nodes: [{ address: 'localhost', port: 13001 }],
      });

      // Register streaming action
      server.setAction('counter', async function* (max: number) {
        for (let i = 1; i <= max; i++) {
          yield { count: i };
          await new Promise((r) => setTimeout(r, 10)); // Simulate work
        }
      });

      await Promise.all([server.start(), client.start()]);
      await waitForConnection(client, 'stream-server');
    });

    afterAll(async () => {
      await client.stop();
      await server.stop();
    });

    it('receives all chunks correctly', async () => {
      const received: number[] = [];

      // Consume stream
      for await (const chunk of client.callStream('counter', 5)) {
        received.push(chunk.count);
      }

      expect(received).toEqual([1, 2, 3, 4, 5]);
      console.log('Streaming test passed: received all chunks correctly');
    });
  });

  describe('Should handle stream errors', () => {
    let server: Xerver;
    let client: Xerver;

    beforeAll(async () => {
      server = new Xerver({ name: 'error-server', port: 13003 });
      client = new Xerver({
        name: 'error-client',
        port: 13004,
        nodes: [{ address: 'localhost', port: 13003 }],
      });

      server.setAction('faultyStream', async function* () {
        yield 1;
        yield 2;
        throw new Error('Stream exploded');
      });

      await Promise.all([server.start(), client.start()]);
      await waitForConnection(client, 'error-server');
    });

    afterAll(async () => {
      await client.stop();
      await server.stop();
    });

    it('catches stream error after receiving partial data', async () => {
      const received: number[] = [];
      let errorCaught = false;

      try {
        for await (const chunk of client.callStream('faultyStream', null)) {
          received.push(chunk);
        }
      } catch (err: any) {
        errorCaught = true;
        expect(err.message).toBe('Stream exploded');
      }

      expect(received).toEqual([1, 2]); // Should receive data before error
      expect(errorCaught).toBe(true);
    });
  });

  describe('Should stream through a relay node (Mesh Streaming)', () => {
    let server: Xerver;
    let relay: Xerver;
    let client: Xerver;

    beforeAll(async () => {
      server = new Xerver({ name: 'mesh-server', port: 13005 });
      relay = new Xerver({
        name: 'mesh-relay',
        port: 13006,
        nodes: [{ address: 'localhost', port: 13005 }],
      });
      client = new Xerver({
        name: 'mesh-client',
        port: 13007,
        nodes: [{ address: 'localhost', port: 13006 }],
      });

      server.setAction('meshStream', async function* () {
        yield 'hop1';
        yield 'hop2';
        yield 'hop3';
      });

      await Promise.all([server.start(), relay.start(), client.start()]);
      await waitForConnection(relay, 'mesh-server');
      await waitForConnection(client, 'mesh-relay');

      // Wait for handshake propagation
      await new Promise((r) => setTimeout(r, 500));
    });

    afterAll(async () => {
      await client.stop();
      await relay.stop();
      await server.stop();
    });

    it('receives all chunks through relay', async () => {
      const received: string[] = [];
      for await (const chunk of client.callStream('meshStream', null)) {
        received.push(chunk);
      }

      expect(received).toEqual(['hop1', 'hop2', 'hop3']);
      console.log('Mesh streaming passed');
    });
  });

  describe('Should stream large binary data (1MB, 5MB, 10MB)', () => {
    let server: Xerver;
    let client: Xerver;

    beforeAll(async () => {
      server = new Xerver({ name: 'binary-server', port: 13008 });
      client = new Xerver({
        name: 'binary-client',
        port: 13009,
        nodes: [{ address: 'localhost', port: 13008 }],
      });

      // A stream that generates 'size' bytes in chunks
      server.setAction(
        'binaryStream',
        async function* (size: number) {
          const chunkSize = 64 * 1024; // 64KB chunks
          let sent = 0;
          while (sent < size) {
            const remaining = size - sent;
            const currentChunkSize = Math.min(chunkSize, remaining);
            const buffer = crypto.randomBytes(currentChunkSize);
            yield buffer;
            sent += currentChunkSize;
          }
        },
        { serializer: 'msgpack' },
      ); // Ensure msgpack is used for binary

      await Promise.all([server.start(), client.start()]);
      await waitForConnection(client, 'binary-server');
    });

    afterAll(async () => {
      await client.stop();
      await server.stop();
    });

    it('streams 1MB binary data', async () => {
      const size = 1 * 1024 * 1024;
      console.log(`Streaming ${size / 1024 / 1024}MB...`);
      const start = Date.now();
      let receivedBytes = 0;

      for await (const chunk of client.callStream('binaryStream', size)) {
        if (Buffer.isBuffer(chunk)) {
          receivedBytes += chunk.length;
        } else if (
          chunk &&
          chunk.type === 'Buffer' &&
          Array.isArray(chunk.data)
        ) {
          receivedBytes += chunk.data.length;
        } else {
          receivedBytes += chunk.length || 0;
        }
      }

      const duration = Date.now() - start;
      console.log(`Streamed ${size / 1024 / 1024}MB in ${duration}ms`);
      expect(receivedBytes).toBe(size);
    });

    it('streams 5MB binary data', async () => {
      const size = 5 * 1024 * 1024;
      console.log(`Streaming ${size / 1024 / 1024}MB...`);
      const start = Date.now();
      let receivedBytes = 0;

      for await (const chunk of client.callStream('binaryStream', size)) {
        if (Buffer.isBuffer(chunk)) {
          receivedBytes += chunk.length;
        } else if (
          chunk &&
          chunk.type === 'Buffer' &&
          Array.isArray(chunk.data)
        ) {
          receivedBytes += chunk.data.length;
        } else {
          receivedBytes += chunk.length || 0;
        }
      }

      const duration = Date.now() - start;
      console.log(`Streamed ${size / 1024 / 1024}MB in ${duration}ms`);
      expect(receivedBytes).toBe(size);
    });

    it('streams 10MB binary data', async () => {
      const size = 10 * 1024 * 1024;
      console.log(`Streaming ${size / 1024 / 1024}MB...`);
      const start = Date.now();
      let receivedBytes = 0;

      for await (const chunk of client.callStream('binaryStream', size)) {
        if (Buffer.isBuffer(chunk)) {
          receivedBytes += chunk.length;
        } else if (
          chunk &&
          chunk.type === 'Buffer' &&
          Array.isArray(chunk.data)
        ) {
          receivedBytes += chunk.data.length;
        } else {
          receivedBytes += chunk.length || 0;
        }
      }

      const duration = Date.now() - start;
      console.log(`Streamed ${size / 1024 / 1024}MB in ${duration}ms`);
      expect(receivedBytes).toBe(size);
    });
  });
});
