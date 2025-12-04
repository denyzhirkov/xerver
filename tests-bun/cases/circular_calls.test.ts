import { describe, it, beforeAll, afterAll, expect } from 'bun:test';
import { Xerver } from '../../src/Xerver';

describe('Xerver Circular & Nested Calls Tests', () => {
  let nodeA: Xerver;
  let nodeB: Xerver;
  let nodeC: Xerver;

  // Topology: A <-> B <-> C
  // Flow: A.call(C.complex) -> C calls A.random -> A returns -> C computes -> returns to A

  beforeAll(async () => {
    nodeA = new Xerver({ name: 'A', port: 7001 });

    // Action on A that generates a number
    nodeA.setAction('getRandom', () => {
      return 42; // Deterministic for testing
    });

    nodeA.start();

    nodeB = new Xerver({
      name: 'B',
      port: 7002,
      nodes: [{ address: 'localhost', port: 7001 }],
    });
    nodeB.start();

    nodeC = new Xerver({
      name: 'C',
      port: 7003,
      nodes: [{ address: 'localhost', port: 7002 }],
    });

    // Action on C that needs data from A
    nodeC.setAction('complexCalculation', async (baseValue: number) => {
      // C calls A back
      const randomFactor = await nodeC.callAction('getRandom', []);
      return baseValue * randomFactor;
    });

    nodeC.start();

    // Wait for full mesh convergence
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]);
  });

  it('should handle nested circular calls (A -> B -> C -> B -> A -> B -> C -> B -> A)', async () => {
    // A calls C ('complexCalculation'), which calls A ('getRandom')
    // Path Request 1: A -> B -> C ('complexCalculation')
    // Path Request 2 (inside C): C -> B -> A ('getRandom')
    // Path Response 2: A -> B -> C (returns 42)
    // Path Response 1: C -> B -> A (returns result)

    const result = await nodeA.callAction('complexCalculation', 10);
    expect(result).toBe(420); // 10 * 42
  });
});

