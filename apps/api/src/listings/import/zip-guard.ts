import { inflateRawSync } from 'zlib';

// Checks an .xlsx (a ZIP archive) before any library unpacks it: the sizes
// declared in the ZIP central directory must stay within limits, so a small
// upload cannot expand into gigabytes in memory (zip bomb).

export const ZIP_LIMITS = {
  /** Sum of uncompressed sizes of all entries */
  maxTotalUncompressed: 60 * 1024 * 1024,
  /** Largest expansion ratio of any entry (XML usually compresses 5–20×) */
  maxRatio: 200,
  maxEntries: 2_000,
};

export class ZipGuardError extends Error {}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

/** Throws ZipGuardError when the archive is malformed, ZIP64 or too large unpacked */
export function assertSafeZip(buf: Buffer, limits = ZIP_LIMITS): void {
  // End of central directory: last 22 bytes + up to 64 KB comment
  const from = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipGuardError('Not a valid .xlsx file (no ZIP directory)');

  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipGuardError('ZIP64 archives are not accepted');
  }
  if (entries > limits.maxEntries) throw new ZipGuardError('The file has too many parts');
  if (cdOffset + cdSize > buf.length) throw new ZipGuardError('Not a valid .xlsx file (broken ZIP directory)');

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) {
      throw new ZipGuardError('Not a valid .xlsx file (broken ZIP entry)');
    }
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new ZipGuardError('ZIP64 archives are not accepted');
    if (uncompressed > 0 && uncompressed / Math.max(compressed, 1) > limits.maxRatio) {
      throw new ZipGuardError('The file expands too much when unpacked');
    }
    total += uncompressed;
    if (total > limits.maxTotalUncompressed) throw new ZipGuardError('The file is too large when unpacked');
    // The directory can lie: inflate the entry with a hard output cap and
    // check that it really is the declared size
    verifyEntry(buf, buf.readUInt32LE(p + 42), buf.readUInt16LE(p + 10), compressed, uncompressed);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}

const LFH_SIG = 0x04034b50;

function verifyEntry(buf: Buffer, localOffset: number, method: number, compressed: number, uncompressed: number): void {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LFH_SIG) {
    throw new ZipGuardError('Not a valid .xlsx file (broken ZIP entry)');
  }
  const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
  if (start + compressed > buf.length) throw new ZipGuardError('Not a valid .xlsx file (truncated)');
  const data = buf.subarray(start, start + compressed);
  let size: number;
  if (method === 0) {
    size = data.length;
  } else if (method === 8) {
    try {
      size = inflateRawSync(data, { maxOutputLength: uncompressed + 1 }).length;
    } catch {
      throw new ZipGuardError('The file expands more than it declares (or is corrupt)');
    }
  } else {
    throw new ZipGuardError('Unsupported compression in the file');
  }
  if (size !== uncompressed) throw new ZipGuardError('The file expands more than it declares (or is corrupt)');
}
