import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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

describe('Xerver Load Tests', () => {
  describe('Direct Connection Load Test (10k requests)', () => {
    let server: Xerver;
    let client: Xerver;

    beforeAll(async () => {
      server = new Xerver({ name: 'server', port: 11001 });
      client = new Xerver({
        name: 'client',
        port: 11002,
        nodes: [{ address: 'localhost', port: 11001 }],
        requestTimeout: 30000, // Increased timeout for load test
      });

      server.setAction('echo', (data) => data);

      await Promise.all([server.start(), client.start()]);
      await waitForConnection(client, 'server');
    });

    afterAll(async () => {
      await client.stop();
      await server.stop();
    });

    it('should handle 10k requests', async () => {
      const TOTAL_REQUESTS = 10000;
      const BATCH_SIZE = 100;
      const start = Date.now();
      let completed = 0;

      // Send requests in batches to avoid overwhelming the event loop immediately
      for (let i = 0; i < TOTAL_REQUESTS; i += BATCH_SIZE) {
        const promises = [];
        for (let j = 0; j < BATCH_SIZE; j++) {
          promises.push(client.callAction('echo', { id: i + j }));
        }
        await Promise.all(promises);
        completed += promises.length;
      }

      const duration = Date.now() - start;
      const rps = (TOTAL_REQUESTS / duration) * 1000;

      console.log(`[Direct] ${TOTAL_REQUESTS} requests took ${duration}ms`);
      console.log(`[Direct] RPS: ${rps.toFixed(2)}`);

      expect(completed).toBe(TOTAL_REQUESTS);
      expect(rps).toBeGreaterThan(0); // Basic sanity check
    });
  });

  describe('Mesh Connection Load Test (Relay Node)', () => {
    let server: Xerver;
    let relay: Xerver;
    let client: Xerver;

    beforeAll(async () => {
      // Topology: Client -> Relay -> Server
      server = new Xerver({ name: 'server', port: 12001 });
      relay = new Xerver({
        name: 'relay',
        port: 12002,
        nodes: [{ address: 'localhost', port: 12001 }],
      });
      client = new Xerver({
        name: 'client',
        port: 12003,
        nodes: [{ address: 'localhost', port: 12002 }],
        requestTimeout: 30000,
      });

      server.setAction('echo', (data) => data);

      await Promise.all([server.start(), relay.start(), client.start()]);

      // Wait for full mesh propagation
      await waitForConnection(relay, 'server');
      await waitForConnection(client, 'relay');

      // Wait a bit for action info to propagate (handshakes)
      await new Promise((r) => setTimeout(r, 500));
    });

    afterAll(async () => {
      await client.stop();
      await relay.stop();
      await server.stop();
    });

    it('should handle 5k requests through relay', async () => {
      const TOTAL_REQUESTS = 5000; // Slightly less for mesh test
      const BATCH_SIZE = 50;
      const start = Date.now();
      let completed = 0;

      for (let i = 0; i < TOTAL_REQUESTS; i += BATCH_SIZE) {
        const promises = [];
        for (let j = 0; j < BATCH_SIZE; j++) {
          promises.push(client.callAction('echo', { id: i + j }));
        }
        await Promise.all(promises);
        completed += promises.length;
      }

      const duration = Date.now() - start;
      const rps = (TOTAL_REQUESTS / duration) * 1000;

      console.log(`[Mesh] ${TOTAL_REQUESTS} requests took ${duration}ms`);
      console.log(`[Mesh] RPS: ${rps.toFixed(2)}`);

      expect(completed).toBe(TOTAL_REQUESTS);
    });
  });
});
