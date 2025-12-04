import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Xerver } from '../../src/Xerver';

describe('Xerver Serialization Tests', () => {
  let nodeServer: Xerver;
  let nodeClient: Xerver;

  beforeAll(async () => {
    nodeServer = new Xerver({ name: 'Server', port: 6001 });

    nodeServer.setAction('echo_json', (data) => data, { serializer: 'json' });
    nodeServer.setAction('echo_msgpack', (data) => data, {
      serializer: 'msgpack',
    });

    nodeServer.start();

    nodeClient = new Xerver({
      name: 'Client',
      port: 6002,
      nodes: [{ address: 'localhost', port: 6001 }],
    });
    nodeClient.start();

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    await Promise.all([nodeServer.stop(), nodeClient.stop()]);
  });

  it('should correctly serialize/deserialize using JSON (default)', async () => {
    const input = { text: 'hello', number: 123, bool: true };
    const result = await nodeClient.callAction('echo_json', input);
    expect(result).toEqual(input);
  });

  it('should correctly serialize/deserialize using MsgPack', async () => {
    const input = {
      buffer: Buffer.from('test buffer').toString('base64'),
      largeNum: 999999999,
    };
    const result = await nodeClient.callAction('echo_msgpack', input);
    expect(result).toEqual(input);
  });
});
