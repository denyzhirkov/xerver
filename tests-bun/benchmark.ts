import * as crypto from 'node:crypto';
import { Xerver } from '../src/Xerver';

/**
 * XERVER BENCHMARK - Stress Test for Mesh Network
 *
 * Tests:
 * 1. Deep Chain (10 nodes) - measures latency through many hops
 * 2. Star Topology - measures parallel request handling
 * 3. Large Payload - measures data throughput
 * 4. Streaming Throughput - measures streaming performance
 * 5. Concurrent Connections - measures connection scaling
 */

const PORT_BASE = 20000;

interface BenchmarkResult {
  name: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  durationMs: number;
  rps: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputMBps?: number;
}

function calculatePercentile(sortedArr: number[], percentile: number): number {
  const index = Math.ceil((percentile / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

function formatResult(result: BenchmarkResult): string {
  let output = `
╔══════════════════════════════════════════════════════════════════╗
║ ${result.name.padEnd(64)} ║
╠══════════════════════════════════════════════════════════════════╣
║ Total Requests:     ${String(result.totalRequests).padStart(10)}                                 ║
║ Successful:         ${String(result.successfulRequests).padStart(10)}                                 ║
║ Failed:             ${String(result.failedRequests).padStart(10)}                                 ║
║ Duration:           ${(result.durationMs / 1000).toFixed(2).padStart(10)}s                                ║
╠══════════════════════════════════════════════════════════════════╣
║ RPS:                ${result.rps.toFixed(2).padStart(10)}                                 ║
║ Avg Latency:        ${result.avgLatencyMs.toFixed(2).padStart(10)}ms                               ║
║ Min Latency:        ${result.minLatencyMs.toFixed(2).padStart(10)}ms                               ║
║ Max Latency:        ${result.maxLatencyMs.toFixed(2).padStart(10)}ms                               ║
║ P50 Latency:        ${result.p50LatencyMs.toFixed(2).padStart(10)}ms                               ║
║ P95 Latency:        ${result.p95LatencyMs.toFixed(2).padStart(10)}ms                               ║
║ P99 Latency:        ${result.p99LatencyMs.toFixed(2).padStart(10)}ms                               ║`;

  if (result.throughputMBps !== undefined) {
    output += `
║ Throughput:         ${result.throughputMBps.toFixed(2).padStart(10)} MB/s                            ║`;
  }

  output += `
╚══════════════════════════════════════════════════════════════════╝`;

  return output;
}

async function waitForConnection(
  node: Xerver,
  peerName: string,
  timeout = 5000,
): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (node.peers.has(peerName)) {
        resolve(true);
      } else if (Date.now() - start > timeout) {
        resolve(false);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Deep Chain (10 nodes) - Latency through many hops
// ═══════════════════════════════════════════════════════════════════
async function benchmarkDeepChain(): Promise<BenchmarkResult> {
  console.log('\n🔗 Starting Deep Chain Benchmark (10 nodes)...');

  const CHAIN_LENGTH = 10;
  const REQUESTS = 1000;
  const nodes: Xerver[] = [];

  // Create chain: node0 -> node1 -> node2 -> ... -> node9
  for (let i = 0; i < CHAIN_LENGTH; i++) {
    const config: any = {
      name: `chain-${i}`,
      port: PORT_BASE + i,
      requestTimeout: 30000,
    };

    if (i > 0) {
      config.nodes = [{ address: 'localhost', port: PORT_BASE + i - 1 }];
    }

    const node = new Xerver(config);

    // Only the LAST node has the action
    if (i === CHAIN_LENGTH - 1) {
      node.setAction('deepEcho', (data) => ({
        ...data,
        processedBy: `chain-${i}`,
      }));
    }

    await node.start();
    nodes.push(node);
  }

  // Wait for chain to connect
  for (let i = 1; i < CHAIN_LENGTH; i++) {
    await waitForConnection(nodes[i], `chain-${i - 1}`);
  }
  await new Promise((r) => setTimeout(r, 1000)); // Extra time for handshakes

  console.log(`   Chain built: chain-0 -> ... -> chain-${CHAIN_LENGTH - 1}`);
  console.log(`   Action 'deepEcho' on chain-${CHAIN_LENGTH - 1}`);
  console.log(`   Sending ${REQUESTS} requests from chain-0...`);

  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;

  const startTime = Date.now();

  // Send requests from first node to last node's action
  for (let i = 0; i < REQUESTS; i++) {
    const reqStart = Date.now();
    try {
      const result = await nodes[0].callAction('deepEcho', {
        id: i,
        timestamp: reqStart,
      });
      latencies.push(Date.now() - reqStart);
      successful++;
    } catch (e) {
      failed++;
    }
  }

  const duration = Date.now() - startTime;

  // Cleanup
  for (const node of nodes.reverse()) {
    await node.stop();
  }

  latencies.sort((a, b) => a - b);

  return {
    name: `Deep Chain (${CHAIN_LENGTH} nodes, ${CHAIN_LENGTH - 1} hops)`,
    totalRequests: REQUESTS,
    successfulRequests: successful,
    failedRequests: failed,
    durationMs: duration,
    rps: (successful / duration) * 1000,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Star Topology - Parallel request handling
// ═══════════════════════════════════════════════════════════════════
async function benchmarkStarTopology(): Promise<BenchmarkResult> {
  console.log('\n⭐ Starting Star Topology Benchmark...');

  const WORKERS = 8;
  const REQUESTS_PER_WORKER = 2000;
  const BATCH_SIZE = 100;

  // Create hub
  const hub = new Xerver({
    name: 'hub',
    port: PORT_BASE + 100,
    requestTimeout: 30000,
  });
  hub.setAction('compute', (n: number) => {
    // Simulate some work
    let result = 0;
    for (let i = 0; i < 100; i++) result += Math.sqrt(n + i);
    return result;
  });
  await hub.start();

  // Create workers
  const workers: Xerver[] = [];
  for (let i = 0; i < WORKERS; i++) {
    const worker = new Xerver({
      name: `worker-${i}`,
      port: PORT_BASE + 101 + i,
      nodes: [{ address: 'localhost', port: PORT_BASE + 100 }],
      requestTimeout: 30000,
    });
    await worker.start();
    workers.push(worker);
    await waitForConnection(worker, 'hub');
  }

  await new Promise((r) => setTimeout(r, 500));

  console.log(`   Hub + ${WORKERS} workers created`);
  console.log(
    `   ${REQUESTS_PER_WORKER} requests per worker, ${WORKERS * REQUESTS_PER_WORKER} total`,
  );

  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;

  const startTime = Date.now();

  // All workers send requests in parallel
  const workerPromises = workers.map(async (worker, workerIdx) => {
    for (let batch = 0; batch < REQUESTS_PER_WORKER / BATCH_SIZE; batch++) {
      const batchPromises = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const reqStart = Date.now();
        batchPromises.push(
          worker
            .callAction('compute', workerIdx * 1000 + batch * BATCH_SIZE + i)
            .then(() => {
              latencies.push(Date.now() - reqStart);
              successful++;
            })
            .catch(() => {
              failed++;
            }),
        );
      }
      await Promise.all(batchPromises);
    }
  });

  await Promise.all(workerPromises);

  const duration = Date.now() - startTime;

  // Cleanup
  for (const worker of workers) {
    await worker.stop();
  }
  await hub.stop();

  latencies.sort((a, b) => a - b);

  return {
    name: `Star Topology (1 hub + ${WORKERS} workers)`,
    totalRequests: WORKERS * REQUESTS_PER_WORKER,
    successfulRequests: successful,
    failedRequests: failed,
    durationMs: duration,
    rps: (successful / duration) * 1000,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Large Payload - Data throughput
// ═══════════════════════════════════════════════════════════════════
async function benchmarkLargePayload(): Promise<BenchmarkResult> {
  console.log('\n📦 Starting Large Payload Benchmark...');

  const PAYLOAD_SIZES = [
    64 * 1024, // 64 KB
    256 * 1024, // 256 KB
    1024 * 1024, // 1 MB
  ];
  const REQUESTS_PER_SIZE = 50;

  const server = new Xerver({
    name: 'payload-server',
    port: PORT_BASE + 200,
    requestTimeout: 60000,
  });
  server.setAction('mirror', (data: { payload: string }) => data);
  await server.start();

  const client = new Xerver({
    name: 'payload-client',
    port: PORT_BASE + 201,
    nodes: [{ address: 'localhost', port: PORT_BASE + 200 }],
    requestTimeout: 60000,
  });
  await client.start();
  await waitForConnection(client, 'payload-server');

  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;
  let totalBytes = 0;

  const startTime = Date.now();

  for (const size of PAYLOAD_SIZES) {
    console.log(`   Testing ${(size / 1024).toFixed(0)} KB payloads...`);
    const payload = 'x'.repeat(size);

    for (let i = 0; i < REQUESTS_PER_SIZE; i++) {
      const reqStart = Date.now();
      try {
        const result = await client.callAction('mirror', { payload });
        if (result.payload.length === size) {
          latencies.push(Date.now() - reqStart);
          successful++;
          totalBytes += size * 2; // Request + Response
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }
  }

  const duration = Date.now() - startTime;

  await client.stop();
  await server.stop();

  latencies.sort((a, b) => a - b);

  return {
    name: 'Large Payload (64KB, 256KB, 1MB)',
    totalRequests: PAYLOAD_SIZES.length * REQUESTS_PER_SIZE,
    successfulRequests: successful,
    failedRequests: failed,
    durationMs: duration,
    rps: (successful / duration) * 1000,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
    throughputMBps: totalBytes / 1024 / 1024 / (duration / 1000),
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Streaming Throughput - measures streaming performance
// ═══════════════════════════════════════════════════════════════════
async function benchmarkStreaming(): Promise<BenchmarkResult> {
  console.log('\n🌊 Starting Streaming Benchmark...');

  const STREAM_SIZES = [
    { chunks: 100, chunkSize: 10 * 1024 }, // 100 x 10KB = 1MB
    { chunks: 50, chunkSize: 100 * 1024 }, // 50 x 100KB = 5MB
    { chunks: 100, chunkSize: 100 * 1024 }, // 100 x 100KB = 10MB
  ];
  const STREAMS_PER_SIZE = 5;

  const server = new Xerver({
    name: 'stream-server',
    port: PORT_BASE + 300,
    requestTimeout: 120000,
  });

  server.setAction(
    'dataStream',
    async function* (config: { chunks: number; chunkSize: number }) {
      for (let i = 0; i < config.chunks; i++) {
        yield crypto.randomBytes(config.chunkSize);
      }
    },
    { serializer: 'msgpack' },
  );

  await server.start();

  const client = new Xerver({
    name: 'stream-client',
    port: PORT_BASE + 301,
    nodes: [{ address: 'localhost', port: PORT_BASE + 300 }],
    requestTimeout: 120000,
  });
  await client.start();
  await waitForConnection(client, 'stream-server');

  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;
  let totalBytes = 0;

  const startTime = Date.now();

  for (const sizeConfig of STREAM_SIZES) {
    const expectedSize = sizeConfig.chunks * sizeConfig.chunkSize;
    console.log(
      `   Streaming ${(expectedSize / 1024 / 1024).toFixed(0)}MB (${sizeConfig.chunks} x ${(sizeConfig.chunkSize / 1024).toFixed(0)}KB)...`,
    );

    for (let i = 0; i < STREAMS_PER_SIZE; i++) {
      const reqStart = Date.now();
      let receivedBytes = 0;

      try {
        for await (const chunk of client.callStream('dataStream', sizeConfig)) {
          if (Buffer.isBuffer(chunk)) {
            receivedBytes += chunk.length;
          } else if (chunk?.type === 'Buffer' && Array.isArray(chunk.data)) {
            receivedBytes += chunk.data.length;
          } else if (chunk?.length) {
            receivedBytes += chunk.length;
          }
        }

        latencies.push(Date.now() - reqStart);
        successful++;
        totalBytes += receivedBytes;
      } catch (e) {
        failed++;
      }
    }
  }

  const duration = Date.now() - startTime;

  await client.stop();
  await server.stop();

  latencies.sort((a, b) => a - b);

  return {
    name: 'Streaming (1MB, 5MB, 10MB)',
    totalRequests: STREAM_SIZES.length * STREAMS_PER_SIZE,
    successfulRequests: successful,
    failedRequests: failed,
    durationMs: duration,
    rps: (successful / duration) * 1000,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
    throughputMBps: totalBytes / 1024 / 1024 / (duration / 1000),
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Mesh Flood - Complex topology stress test
// ═══════════════════════════════════════════════════════════════════
async function benchmarkMeshFlood(): Promise<BenchmarkResult> {
  console.log('\n🕸️  Starting Mesh Flood Benchmark...');

  /*
   * Topology (12 nodes):
   *
   *              [gateway]
   *             /    |    \
   *        [hub1] [hub2] [hub3]
   *        / |     / |     | \
   *    [w1][w2] [w3][w4] [w5][w6]
   *
   * Action 'process' only on workers (w1-w6)
   * Requests from gateway traverse 2 hops minimum
   */

  const REQUESTS = 3000;
  const BATCH_SIZE = 50;

  // Gateway
  const gateway = new Xerver({
    name: 'gateway',
    port: PORT_BASE + 400,
    requestTimeout: 30000,
  });
  await gateway.start();

  const allNodes: Xerver[] = [gateway];

  // 3 Hubs connected to gateway
  const hubs: Xerver[] = [];
  for (let i = 1; i <= 3; i++) {
    const hub = new Xerver({
      name: `hub${i}`,
      port: PORT_BASE + 400 + i,
      nodes: [{ address: 'localhost', port: PORT_BASE + 400 }],
      requestTimeout: 30000,
    });
    await hub.start();
    hubs.push(hub);
    allNodes.push(hub);
  }

  // 2 Workers per hub (6 total)
  const workers: Xerver[] = [];
  let workerIdx = 0;
  for (let hubIdx = 0; hubIdx < 3; hubIdx++) {
    for (let w = 0; w < 2; w++) {
      workerIdx++;
      const worker = new Xerver({
        name: `worker${workerIdx}`,
        port: PORT_BASE + 410 + workerIdx,
        nodes: [{ address: 'localhost', port: PORT_BASE + 401 + hubIdx }],
        requestTimeout: 30000,
      });

      // Action only on workers
      worker.setAction('process', (data: { value: number }) => {
        // Simulate work
        let result = data.value;
        for (let i = 0; i < 50; i++)
          result = Math.sin(result) + Math.cos(result);
        return { result, worker: `worker${workerIdx}` };
      });

      await worker.start();
      workers.push(worker);
      allNodes.push(worker);
    }
  }

  // Wait for connections
  for (const hub of hubs) {
    await waitForConnection(hub, 'gateway');
  }
  for (let i = 0; i < workers.length; i++) {
    const hubName = `hub${Math.floor(i / 2) + 1}`;
    await waitForConnection(workers[i], hubName);
  }
  await new Promise((r) => setTimeout(r, 1000));

  console.log(`   Topology: 1 gateway -> 3 hubs -> 6 workers`);
  console.log(`   Sending ${REQUESTS} requests from gateway...`);

  const latencies: number[] = [];
  const workerHits: Map<string, number> = new Map();
  let successful = 0;
  let failed = 0;

  const startTime = Date.now();

  // Send requests in batches from gateway
  for (let batch = 0; batch < REQUESTS / BATCH_SIZE; batch++) {
    const batchPromises = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      const reqStart = Date.now();
      batchPromises.push(
        gateway
          .callAction('process', { value: batch * BATCH_SIZE + i })
          .then((result: { worker: string }) => {
            latencies.push(Date.now() - reqStart);
            successful++;
            workerHits.set(
              result.worker,
              (workerHits.get(result.worker) || 0) + 1,
            );
          })
          .catch(() => {
            failed++;
          }),
      );
    }

    await Promise.all(batchPromises);
  }

  const duration = Date.now() - startTime;

  // Log load distribution
  console.log('   Worker load distribution:');
  for (const [worker, hits] of workerHits) {
    console.log(
      `     ${worker}: ${hits} requests (${((hits / successful) * 100).toFixed(1)}%)`,
    );
  }

  // Cleanup
  for (const node of allNodes.reverse()) {
    await node.stop();
  }

  latencies.sort((a, b) => a - b);

  return {
    name: 'Mesh Flood (12 nodes, 2+ hops)',
    totalRequests: REQUESTS,
    successfulRequests: successful,
    failedRequests: failed,
    durationMs: duration,
    rps: (successful / duration) * 1000,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log(
    '╔══════════════════════════════════════════════════════════════════╗',
  );
  console.log(
    '║           XERVER BENCHMARK - Mesh Network Stress Test            ║',
  );
  console.log(
    '║                         Running on Bun                           ║',
  );
  console.log(
    '╚══════════════════════════════════════════════════════════════════╝',
  );
  console.log(`\nRuntime: Bun ${Bun.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`CPUs: ${navigator.hardwareConcurrency || 'unknown'}`);

  const results: BenchmarkResult[] = [];

  try {
    // Run all benchmarks
    results.push(await benchmarkDeepChain());
    results.push(await benchmarkStarTopology());
    results.push(await benchmarkLargePayload());
    results.push(await benchmarkStreaming());
    results.push(await benchmarkMeshFlood());

    // Print summary
    console.log('\n\n');
    console.log(
      '╔══════════════════════════════════════════════════════════════════╗',
    );
    console.log(
      '║                        BENCHMARK RESULTS                         ║',
    );
    console.log(
      '╚══════════════════════════════════════════════════════════════════╝',
    );

    for (const result of results) {
      console.log(formatResult(result));
    }

    // Summary table
    console.log('\n\n📊 SUMMARY TABLE\n');
    console.log(
      '┌─────────────────────────────────────┬──────────┬──────────┬──────────┐',
    );
    console.log(
      '│ Test                                │ RPS      │ P50 (ms) │ P99 (ms) │',
    );
    console.log(
      '├─────────────────────────────────────┼──────────┼──────────┼──────────┤',
    );
    for (const r of results) {
      const name = r.name.substring(0, 35).padEnd(35);
      const rps = r.rps.toFixed(0).padStart(8);
      const p50 = r.p50LatencyMs.toFixed(1).padStart(8);
      const p99 = r.p99LatencyMs.toFixed(1).padStart(8);
      console.log(`│ ${name} │ ${rps} │ ${p50} │ ${p99} │`);
    }
    console.log(
      '└─────────────────────────────────────┴──────────┴──────────┴──────────┘',
    );
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
