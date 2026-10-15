/**
 * 32-bit float WAV writer. Float keeps the render's exact samples, including
 * any headroom above full scale, and is read by browsers' decodeAudioData and
 * common audio tools.
 *
 * Besides the standard `fmt `, `fact` and `data` chunks the file carries a
 * LIST/INFO chunk (title, software, comment) and a `phos` chunk with JSON
 * describing how it was made. Players ignore chunks they do not know.
 */
export type WavMetadata = {
  title?: string;
  comment?: string;
  software?: string;
  /** Machine-readable provenance, stored in the `phos` chunk. */
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
  // INFO strings are NUL-terminated.
  const bytes = encoder.encode(text);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
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
  if (channels.some((c) => c.length !== frames)) throw new Error("Channels must be the same length.");

  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, 3, true); // WAVE_FORMAT_IEEE_FLOAT
  fv.setUint16(2, count, true);
  fv.setUint32(4, sampleRate, true);
  fv.setUint32(8, sampleRate * count * 4, true);
  fv.setUint16(12, count * 4, true);
  fv.setUint16(14, 32, true);

  const fact = new Uint8Array(4);
  new DataView(fact.buffer).setUint32(0, frames, true);

  const data = new Uint8Array(frames * count * 4);
  const dv = new DataView(data.buffer);
  for (let i = 0, o = 0; i < frames; i++) {
    for (let c = 0; c < count; c++, o += 4) dv.setFloat32(o, channels[c]![i]!, true);
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
  chunks: string[];
  info: Record<string, string>;
  json: unknown;
};

/** Reads the files this module writes (used by tests and for round-trip checks). */
export function decodeFloatWav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("Not a WAV file.");
  if (view.getUint32(4, true) !== bytes.length - 8) throw new Error("RIFF size is wrong.");
  let offset = 12;
  let sampleRate = 0;
  let count = 0;
  let channels: Float32Array[] = [];
  const chunks: string[] = [];
  const info: Record<string, string> = {};
  let json: unknown = undefined;
  const decoder = new TextDecoder();
  while (offset + 8 <= bytes.length) {
    const id = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    chunks.push(id);
    if (id === "fmt ") {
      if (view.getUint16(start, true) !== 3 || view.getUint16(start + 14, true) !== 32) throw new Error("Not 32-bit float.");
      count = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
    } else if (id === "data") {
      const frames = size / (count * 4);
      channels = Array.from({ length: count }, () => new Float32Array(frames));
      for (let i = 0, o = start; i < frames; i++) {
        for (let c = 0; c < count; c++, o += 4) channels[c]![i] = view.getFloat32(o, true);
      }
    } else if (id === "LIST" && text(start, 4) === "INFO") {
      let o = start + 4;
      while (o + 8 <= start + size) {
        const key = text(o, 4);
        const n = view.getUint32(o + 4, true);
        info[key] = decoder.decode(bytes.subarray(o + 8, o + 8 + n)).replace(/\0+$/, "");
        o += 8 + n + (n % 2);
      }
    } else if (id === "phos") {
      json = JSON.parse(decoder.decode(bytes.subarray(start, start + size)));
    }
    offset = start + size + (size % 2);
  }
  return { sampleRate, channels, chunks, info, json };
}
