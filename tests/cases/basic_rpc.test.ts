import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Xerver } from '../../src/Xerver';

describe('Xerver Integration Tests', () => {
  let nodeA: Xerver;
  let nodeB: Xerver;
  let nodeC: Xerver;
  let nodeD: Xerver;

  before(async () => {
    // Setup 4 nodes: A <-> B <-> C <-> D
    nodeA = new Xerver({ name: 'A', port: 5001 });
    nodeA.setAction('sum', (args: number[]) => args.reduce((a, b) => a + b, 0));
    nodeA.start();

    nodeB = new Xerver({
      name: 'B',
      port: 5002,
      nodes: [{ address: 'localhost', port: 5001 }],
    });
    nodeB.start();

    nodeC = new Xerver({
      name: 'C',
      port: 5003,
      nodes: [{ address: 'localhost', port: 5002 }],
    });
    nodeC.start();

    nodeD = new Xerver({
      name: 'D',
      port: 5004,
      nodes: [{ address: 'localhost', port: 5003 }],
    });
    nodeD.start();

    // Wait for mesh to converge
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  after(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop(), nodeD.stop()]);
  });

  it('should execute local action on Node A', async () => {
    const result = await nodeA.callAction('sum', [1, 2, 3]);
    assert.strictEqual(result, 6);
  });

  it('should execute direct remote action (B -> A)', async () => {
    const result = await nodeB.callAction('sum', [10, 20]);
    assert.strictEqual(result, 30);
  });

  it('should execute multi-hop remote action (D -> ... -> A)', async () => {
    const result = await nodeD.callAction('sum', [1, 1, 1, 1, 1]);
    assert.strictEqual(result, 5);
  });

  it('should fail when action does not exist', async () => {
    await assert.rejects(
      async () => {
        await nodeD.callAction('non_existent_action', []);
      },
      {
        message: /Timeout calling action/,
      },
    );
  });
});
