/**
 * 32-bit float WAV. Float keeps the rendered samples unchanged, including
 * peaks above full scale. Players that do not know the LIST/INFO or `phos`
 * chunks skip them.
 */
export type WavMetadata = {
  title?: string;
  comment?: string;
  software?: string;
  json?: unknown;
};

const encoder = new TextEncoder();

function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length + (body.length % 2);
  const out = new Uint8Array(8 + padded);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  view.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function infoText(text: string): Uint8Array {
  const bytes = encoder.encode(text);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function encodeFloatWav(
  channels: Float32Array[],
  sampleRate: number,
  metadata: WavMetadata = {},
): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  if (count < 1 || count > 2) throw new Error("WAV export supports mono or stereo.");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error("Unsupported sample rate.");
  }
  if (channels.some((channel) => channel.length !== frames)) throw new Error("Channels must be the same length.");

  const fmt = new Uint8Array(16);
  const format = new DataView(fmt.buffer);
  format.setUint16(0, 3, true);
  format.setUint16(2, count, true);
  format.setUint32(4, sampleRate, true);
  format.setUint32(8, sampleRate * count * 4, true);
  format.setUint16(12, count * 4, true);
  format.setUint16(14, 32, true);

  const fact = new Uint8Array(4);
  new DataView(fact.buffer).setUint32(0, frames, true);

  const data = new Uint8Array(frames * count * 4);
  const view = new DataView(data.buffer);
  for (let i = 0, offset = 0; i < frames; i++) {
    for (let channel = 0; channel < count; channel++, offset += 4) {
      view.setFloat32(offset, channels[channel]![i]!, true);
    }
  }

  const info: Uint8Array[] = [];
  if (metadata.title) info.push(chunk("INAM", infoText(metadata.title)));
  if (metadata.software) info.push(chunk("ISFT", infoText(metadata.software)));
  if (metadata.comment) info.push(chunk("ICMT", infoText(metadata.comment)));
  const parts = [chunk("fmt ", fmt), chunk("fact", fact)];
  if (info.length) parts.push(chunk("LIST", concat([encoder.encode("INFO"), ...info])));
  if (metadata.json !== undefined) parts.push(chunk("phos", encoder.encode(JSON.stringify(metadata.json))));
  parts.push(chunk("data", data));
  const body = concat([encoder.encode("WAVE"), ...parts]);
  const header = new Uint8Array(8);
  header.set(encoder.encode("RIFF"));
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concat([header, body]);
}

export type ParsedWav = {
  sampleRate: number;
  channels: Float32Array[];
  info: Record<string, string>;
  json: unknown;
};

export function decodeFloatWav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("Not a WAV file.");
  if (view.getUint32(4, true) !== bytes.length - 8) throw new Error("RIFF size is wrong.");
  let offset = 12;
  let sampleRate = 0;
  let count = 0;
  let channels: Float32Array[] = [];
  const info: Record<string, string> = {};
  let json: unknown;
  const decoder = new TextDecoder();
  while (offset + 8 <= bytes.length) {
    const id = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") {
      if (view.getUint16(start, true) !== 3 || view.getUint16(start + 14, true) !== 32) {
        throw new Error("Not 32-bit float.");
      }
      count = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
    } else if (id === "data") {
      const frames = size / (count * 4);
      channels = Array.from({ length: count }, () => new Float32Array(frames));
      for (let i = 0, cursor = start; i < frames; i++) {
        for (let channel = 0; channel < count; channel++, cursor += 4) {
          channels[channel]![i] = view.getFloat32(cursor, true);
        }
      }
    } else if (id === "LIST" && text(start, 4) === "INFO") {
      let cursor = start + 4;
      while (cursor + 8 <= start + size) {
        const key = text(cursor, 4);
        const length = view.getUint32(cursor + 4, true);
        info[key] = decoder.decode(bytes.subarray(cursor + 8, cursor + 8 + length)).replace(/\0+$/, "");
        cursor += 8 + length + (length % 2);
      }
    } else if (id === "phos") {
      json = JSON.parse(decoder.decode(bytes.subarray(start, start + size)));
    }
    offset = start + size + (size % 2);
  }
  if (!sampleRate || channels.length === 0) throw new Error("WAV data is missing.");
  return { sampleRate, channels, info, json };
}
