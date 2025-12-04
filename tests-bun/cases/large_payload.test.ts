import { describe, it, beforeAll, afterAll, expect } from 'bun:test';
import { Xerver } from '../../src/Xerver';

describe('Xerver Large Payload Tests', () => {
  let nodeA: Xerver;
  let nodeB: Xerver;

  beforeAll(async () => {
    nodeA = new Xerver({
      name: 'A',
      port: 10001,
      requestTimeout: 20000, // Increase timeout for large data
    });

    // Action that simply returns what it received
    nodeA.setAction(
      'mirror',
      (data: any) => {
        return data;
      },
      { serializer: 'json' },
    );

    nodeA.setAction(
      'mirror_binary',
      (data: any) => {
        return data;
      },
      { serializer: 'msgpack' },
    );

    nodeA.start();

    nodeB = new Xerver({
      name: 'B',
      port: 10002,
      nodes: [{ address: 'localhost', port: 10001 }],
      requestTimeout: 20000,
    });
    nodeB.start();

    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
  });

  it('should handle 1MB JSON payload', async () => {
    const largeString = 'x'.repeat(1024 * 1024); // 1MB string
    const input = { data: largeString };

    const result = await nodeB.callAction('mirror', input);

    expect(result.data.length).toBe(1024 * 1024);
    expect(result.data).toBe(largeString);
  });

  it('should handle 5MB JSON payload', async () => {
    const largeString = 'y'.repeat(5 * 1024 * 1024); // 5MB string
    const input = { data: largeString };

    const result = await nodeB.callAction('mirror', input);

    expect(result.data.length).toBe(5 * 1024 * 1024);
  });

  it('should handle 10MB Binary (MsgPack) payload', async () => {
    // Create a 10MB buffer
    const buffer = Buffer.alloc(10 * 1024 * 1024);
    buffer.fill(0x41); // Fill with 'A'

    const input = { data: buffer };

    const start = Date.now();
    const result = await nodeB.callAction('mirror_binary', input);
    const duration = Date.now() - start;

    console.log(`10MB Roundtrip took ${duration}ms`);

    // Check if result.data is valid
    expect(result.data).toBeTruthy();
    
    // Verify size roughly (serialization adds overhead)
    if (result.data.type === 'Buffer') {
      expect(result.data.data.length).toBe(10 * 1024 * 1024);
    } else if (Buffer.isBuffer(result.data)) {
      expect(result.data.length).toBe(10 * 1024 * 1024);
    }
  });
});

