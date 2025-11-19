import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { RequestMonitorEvent } from '../../src/types';
import { Xerver } from '../../src/Xerver';

describe('Xerver Request Monitoring Tests', () => {
  let nodeA: Xerver;
  let nodeB: Xerver;

  const eventsA: RequestMonitorEvent[] = [];
  const eventsB: RequestMonitorEvent[] = [];

  before(async () => {
    nodeA = new Xerver({
      name: 'A',
      port: 8001,
      onrequest: (event) => eventsA.push(event),
    });

    nodeA.setAction('echo', (data) => data);
    nodeA.start();

    nodeB = new Xerver({
      name: 'B',
      port: 8002,
      nodes: [{ address: 'localhost', port: 8001 }],
      onrequest: (event) => eventsB.push(event),
    });
    nodeB.start();

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  after(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
  });

  it('should emit monitoring events for local calls', async () => {
    eventsA.length = 0; // Clear previous events
    await nodeA.callAction('echo', 'test');

    assert.ok(
      eventsA.some((e) => e.type === 'outgoing' && e.action === 'echo'),
    );
    assert.ok(
      eventsA.some((e) => e.type === 'local_execution' && e.action === 'echo'),
    );
  });

  it('should emit monitoring events for remote calls', async () => {
    eventsB.length = 0;
    eventsA.length = 0;

    await nodeB.callAction('echo', 'remote');

    // Node B (Caller)
    assert.ok(
      eventsB.some((e) => e.type === 'outgoing' && e.action === 'echo'),
    );

    // Node A (Receiver)
    assert.ok(
      eventsA.some((e) => e.type === 'incoming' && e.action === 'echo'),
    );
    assert.ok(
      eventsA.some((e) => e.type === 'local_execution' && e.action === 'echo'),
    );
  });
});
