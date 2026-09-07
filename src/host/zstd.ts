/**
 * Minimal Zstandard frame scanner + decompressor for DSH's append-only
 * `session.jsonl.zstd` container.
 *
 * DSH writes each durable batch as an independent Zstandard frame and
 * concatenates them. Node's built-in `zstdDecompressSync` only decodes the
 * first complete frame, so we have to walk the frame structure ourselves and
 * call it once per frame. This is the same frame layout used by
 * `@deepseek-ai/dsh-session-persistence-jsonl`.
 */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { constants, zstdDecompressSync } from 'node:zlib'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'

const ZSTD_MAGIC = 0xfd2fb528 // little-endian bytes: 28 b5 2f fd

export interface ZstdFrameRange {
  start: number
  end: number
}

export interface ZstdFrameScan {
  frames: ZstdFrameRange[]
  tornStart?: number
}

/** Walk a concatenated Zstandard stream and return complete frame ranges.
 *
 * DSH appends frames while a session is live, so the final frame is often
 * incomplete. We therefore treat any trailing partial data as torn (EOF inside
 * final frame) and return only complete frames instead of throwing. Committed
 * corruption (bad magic / reserved bits / reserved block type) throws loud,
 * matching `@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts` so callers
 * do not silently truncate.
 */
export function scanZstdFrames(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): ZstdFrameRange[] {
  const scan = scanZstdFramesWithTorn(buffer, maxFrames)
  return scan.frames
}

export function scanZstdFramesWithTorn(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): ZstdFrameScan {
  const frames: ZstdFrameRange[] = []
  let offset = 0

  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }

    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }

    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }

    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes

    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }

    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }

    frames.push({ start, end: offset })
    if (frames.length >= maxFrames) return { frames }
  }

  return { frames }
}
/** Parse newline-delimited JSONL text into DSH events (packed rows expanded). */
export function parseJsonlEvents(text: string): any[] {
  const events: any[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const decoded = decodeStorageRecord(JSON.parse(trimmed))
      events.push(...decoded)
    } catch {
      // The tail of a live session can end mid-JSON; ignore incomplete rows.
    }
  }
  return events
}

/** Decompress a complete `.jsonl.zstd` file into an array of JSON events. */
export function readSessionLog(file: string): any[] {
  return parseJsonlEvents(decompressSessionLogBuffer(readFileSync(file)))
}

/** Async variant of {@link readSessionLog}; yields to the event loop between frames. */
export async function readSessionLogAsync(file: string): Promise<any[]> {
  const buffer = await readFile(file)
  const frames = scanZstdFrames(buffer)
  const chunks: string[] = []
  for (const frame of frames) {
    const plain = zstdDecompressSync(buffer.subarray(frame.start, frame.end))
    chunks.push(plain.toString('utf8'))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  // Try to recover plaintext from a still-open final frame.
  const lastEnd = frames.length > 0 ? frames[frames.length - 1].end : 0
  if (lastEnd < buffer.length) {
    try {
      const partial = zstdDecompressSync(buffer.subarray(lastEnd), { finishFlush: constants.ZSTD_e_flush })
      chunks.push(partial.toString('utf8'))
    } catch {
      // ignore unreadable partial tail
    }
  }
  return parseJsonlEvents(chunks.join(''))
}

function decompressSessionLogBuffer(buffer: Buffer): string {
  const frames = scanZstdFrames(buffer)
  const chunks: string[] = []
  for (const frame of frames) {
    const plain = zstdDecompressSync(buffer.subarray(frame.start, frame.end))
    chunks.push(plain.toString('utf8'))
  }
  const lastEnd = frames.length > 0 ? frames[frames.length - 1].end : 0
  if (lastEnd < buffer.length) {
    try {
      const partial = zstdDecompressSync(buffer.subarray(lastEnd), { finishFlush: constants.ZSTD_e_flush })
      chunks.push(partial.toString('utf8'))
    } catch {
      // ignore unreadable partial tail
    }
  }
  return chunks.join('')
}

/** Read only the first (session header) frame quickly.
 *
 * Unlike `readSessionLog`, this avoids reading the whole append-only file: it
 * reads chunks until the first complete Zstandard frame is available.
 */
export function readSessionHeader(file: string): any {
  const CHUNK_SIZE = 64 * 1024
  const fd = openSync(file, 'r')
  let acc = Buffer.alloc(0)
  let total = 0
  const scratch = Buffer.alloc(CHUNK_SIZE)
  try {
    for (;;) {
      const bytes = readSync(fd, scratch, 0, scratch.length, total)
      if (bytes <= 0) break
      acc = acc.length === 0 ? Buffer.from(scratch.subarray(0, bytes)) : Buffer.concat([acc, scratch.subarray(0, bytes)])
      total += bytes
      const frames = scanZstdFrames(acc, 1)
      if (frames.length > 0) {
        const plain = zstdDecompressSync(acc.subarray(frames[0].start, frames[0].end))
        const line = plain.toString('utf8').split('\n').map((s) => s.trim()).find(Boolean)
        if (!line) throw new Error(`empty session header: ${file}`)
        return JSON.parse(line)
      }
      if (total > 4 * 1024 * 1024) break
    }
    throw new Error(`empty zstd session log: ${file}`)
  } finally {
    closeSync(fd)
  }
}
