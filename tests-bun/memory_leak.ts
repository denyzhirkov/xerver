import * as crypto from 'node:crypto';
import { Xerver } from '../src/Xerver';

// Memory Leak Test with "Star of Stars" Topology (9 nodes)
// Topology:
//       [L1_1] --- [L2_1]
//          |
//       [CENTER] --- [L2_2] --- [L1_2]
//          |
//       [L2_3] --- [L1_3]
//          |
//       [L2_4] --- [L1_4]

// Actually, user requested: "4-ray star, where center has 4 connections, each has one more"
// Center -> Node_A -> Node_A_Leaf
// Center -> Node_B -> Node_B_Leaf
// ...
// Total: 1 Center + 4 Middle + 4 Leaf = 9 nodes.

const PORT_BASE = 14000;

async function run() {
  console.log('Starting Memory Leak Test (9 nodes) on Bun...');
  console.log('Press Ctrl+C to stop.');

  // 1. Center Node
  const center = new Xerver({ name: 'center', port: PORT_BASE });
  center.setAction('ping', () => 'pong');
  await center.start();

  const nodes: Xerver[] = [center];
  const leafNodes: Xerver[] = [];

  // 2. Create 4 rays
  for (let i = 1; i <= 4; i++) {
    const midPort = PORT_BASE + i;
    const leafPort = PORT_BASE + i + 4;

    const midName = `mid-${i}`;
    const leafName = `leaf-${i}`;

    // Middle Node (connects to Center)
    const mid = new Xerver({
      name: midName,
      port: midPort,
      nodes: [{ address: 'localhost', port: PORT_BASE }], // Connect to Center
      connectionRetryInterval: 1000,
    });

    // Leaf Node (connects to Middle)
    const leaf = new Xerver({
      name: leafName,
      port: leafPort,
      nodes: [{ address: 'localhost', port: midPort }], // Connect to Mid
      connectionRetryInterval: 1000,
    });

    // Register various actions on Leaf nodes
    leaf.setAction('echo', (data) => data);

    leaf.setAction('heavy', () => {
      // Simulate some CPU work / object creation
      const arr = new Array(1000).fill('x');
      return arr.join('');
    });

    leaf.setAction('stream', async function* (count: number) {
      for (let j = 0; j < count; j++) {
        yield { id: j, data: crypto.randomBytes(1024).toString('hex') };
      }
    });

    await mid.start();
    await leaf.start();

    nodes.push(mid);
    nodes.push(leaf);
    leafNodes.push(leaf);
  }

  console.log('All nodes started. Topology built.');
  console.log('Waiting for mesh propagation...');
  await new Promise((r) => setTimeout(r, 2000));

  // 3. Start Infinite Traffic
  // Each leaf calls actions on OTHER leaves randomly

  let totalRequests = 0;
  const reportInterval = setInterval(() => {
    // Bun supports process.memoryUsage() for compatibility
    const used = process.memoryUsage();
    console.log(
      `[${new Date().toISOString()}] Requests: ${totalRequests} | RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB | Heap: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    );

    // Optional: Force garbage collection in Bun (if available)
    if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') {
      Bun.gc(false); // false = minor GC, true = full GC
    }
  }, 5000);

  const runTraffic = async (sourceNode: Xerver) => {
    while (true) {
      try {
        const action = ['echo', 'heavy', 'stream'][
          Math.floor(Math.random() * 3)
        ];

        if (action === 'echo') {
          await sourceNode.callAction('echo', {
            from: sourceNode.config.name,
            ts: Date.now(),
          });
        } else if (action === 'heavy') {
          await sourceNode.callAction('heavy', null);
        } else if (action === 'stream') {
          // Consume stream
          for await (const _ of sourceNode.callStream('stream', 5)) {
            // Consume
          }
        }

        totalRequests++;

        // Small delay to prevent total CPU saturation, we want to test memory over time
        await new Promise((r) => setTimeout(r, 10));
      } catch (e: any) {
        // Ignore timeouts/errors during mesh re-balancing, just log
        if (!e.message.includes('Timeout')) {
          console.error(`Error in ${sourceNode.config.name}:`, e.message);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  // Start a traffic loop for EACH leaf node
  leafNodes.forEach((leaf) => runTraffic(leaf));

  // Keep process alive
  process.on('SIGINT', async () => {
    clearInterval(reportInterval);
    console.log('Stopping nodes...');
    for (const node of nodes) {
      await node.stop();
    }
    process.exit(0);
  });
}

run().catch((err) => console.error(err));
