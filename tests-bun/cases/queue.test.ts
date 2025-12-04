import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Xerver } from '../../src/Xerver';

describe('Xerver Concurrency & Queue Tests', () => {
  let node: Xerver;
  let executionLog: string[] = [];

  beforeAll(async () => {
    node = new Xerver({
      name: 'QueueNode',
      port: 9001,
      maxConcurrency: 1, // Only 1 action at a time!
    });

    // Slow action that takes 100ms
    node.setAction('slowAction', async (id: string) => {
      executionLog.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      executionLog.push(`end:${id}`);
      return id;
    });

    node.start();
    // Wait for start
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await node.stop();
  });

  it('should execute actions sequentially when maxConcurrency is 1', async () => {
    executionLog = [];

    // Call 3 actions simultaneously
    const p1 = node.callAction('slowAction', '1');
    const p2 = node.callAction('slowAction', '2');
    const p3 = node.callAction('slowAction', '3');

    await Promise.all([p1, p2, p3]);

    // Expected order: start:1 -> end:1 -> start:2 -> end:2 -> start:3 -> end:3
    // Or permutation of 1,2,3 but NEVER interleaved (e.g. start:1, start:2...)

    const logString = executionLog.join(',');
    console.log('Execution Log:', logString);

    // Verify no interleaving
    // We check that every 'start' is followed immediately by its corresponding 'end'
    // because concurrency is 1.

    for (let i = 0; i < executionLog.length; i += 2) {
      const start = executionLog[i];
      const end = executionLog[i + 1];

      const id = start.split(':')[1];
      expect(start).toBe(`start:${id}`);
      expect(end).toBe(`end:${id}`);
    }
  });
});
