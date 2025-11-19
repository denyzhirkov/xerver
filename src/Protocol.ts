import type { XerverMessage } from './types';

export class Protocol {
  public static encode(message: XerverMessage): Buffer {
    const json = JSON.stringify(message);
    const length = Buffer.byteLength(json, 'utf8');
    const buffer = Buffer.alloc(4 + length);
    buffer.writeUInt32BE(length, 0);
    buffer.write(json, 4, 'utf8');
    return buffer;
  }

  public static decode(buffer: Buffer): {
    messages: XerverMessage[];
    remaining: Buffer;
  } {
    const messages: XerverMessage[] = [];
    let offset = 0;

    while (offset + 4 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      if (offset + 4 + length > buffer.length) {
        break;
      }
      const json = buffer.toString('utf8', offset + 4, offset + 4 + length);
      try {
        messages.push(JSON.parse(json));
      } catch (e) {
        console.error('Failed to parse message JSON', e);
      }
      offset += 4 + length;
    }

    return {
      messages,
      remaining: buffer.subarray(offset),
    };
  }
}
