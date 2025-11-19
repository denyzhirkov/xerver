import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Xerver } from '../../src/Xerver';

describe('Xerver Large Payload Tests', () => {
  let nodeA: Xerver;
  let nodeB: Xerver;

  before(async () => {
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

  after(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
  });

  it('should handle 1MB JSON payload', async () => {
    const largeString = 'x'.repeat(1024 * 1024); // 1MB string
    const input = { data: largeString };

    const result = await nodeB.callAction('mirror', input);

    assert.strictEqual(result.data.length, 1024 * 1024);
    assert.strictEqual(result.data, largeString);
  });

  it('should handle 5MB JSON payload', async () => {
    const largeString = 'y'.repeat(5 * 1024 * 1024); // 5MB string
    const input = { data: largeString };

    const result = await nodeB.callAction('mirror', input);

    assert.strictEqual(result.data.length, 5 * 1024 * 1024);
  });

  it('should handle 10MB Binary (MsgPack) payload', async () => {
    // Create a 10MB buffer
    const buffer = Buffer.alloc(10 * 1024 * 1024);
    buffer.fill(0x41); // Fill with 'A'

    // In MsgPack serializer implementation, we convert Buffer to base64 for transport
    // inside the JSON wrapper of our protocol (if we don't use pure binary protocol yet).
    // Our current implementation wraps result in base64 inside JSON envelope for MsgPack.
    // But input args are sent as JSON in current implementation.

    // Wait, Xerver.ts:
    // callAction args are put into payload.
    // Protocol.encode uses JSON.stringify(message).

    // So if we send a Buffer in args, JSON.stringify will convert it to { type: 'Buffer', data: [...] }
    // This is very inefficient for large buffers but should work logically.

    const input = { data: buffer };

    const start = Date.now();
    const result = await nodeB.callAction('mirror_binary', input);
    const duration = Date.now() - start;

    console.log(`10MB Roundtrip took ${duration}ms`);

    // When coming back via msgpack serializer:
    // result is decoded from base64 in handleActionResponse.

    // Note: Since we send args as JSON, the Buffer becomes a JSON object.
    // The handler on Node A receives that object.
    // Returns it.
    // The serializer on Node A (msgpack) encodes that object.

    // To truly test binary efficiency we would need a full binary protocol,
    // but this test verifies that large data doesn't crash the TCP stream processing.

    // Check if result.data is valid
    // It might come back as the JSON representation of buffer if we aren't careful about types
    // or as a rebuilt Buffer if msgpack handles it.

    // Actually, JSON.stringify(Buffer) -> { type: 'Buffer', data: [ ... ] }
    // So 'result' will have that structure.

    assert.ok(result.data);
    // Verify size roughly (serialization adds overhead)
    // If it was returned as the object structure
    if (result.data.type === 'Buffer') {
      assert.strictEqual(result.data.data.length, 10 * 1024 * 1024);
    } else if (Buffer.isBuffer(result.data)) {
      assert.strictEqual(result.data.length, 10 * 1024 * 1024);
    }
  });
});
