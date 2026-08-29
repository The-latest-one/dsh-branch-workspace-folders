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
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { constants, zstdDecompressSync } from 'node:zlib';
import { decodeStorageRecord } from '@deepseek-ai/dsh-session';
const ZSTD_MAGIC = 0xfd2fb528; // little-endian bytes: 28 b5 2f fd
/** Walk a concatenated Zstandard stream and return complete frame ranges.
 *
 * DSH appends frames while a session is live, so the final frame is often
 * incomplete. We therefore treat any trailing partial data as end-of-file and
 * return only complete frames instead of throwing.
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
    const frames = [];
    let offset = 0;
    while (offset < buffer.length) {
        const start = offset;
        if (buffer.length - offset < 4)
            break;
        if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC)
            break;
        offset += 4;
        if (offset === buffer.length)
            break;
        const descriptor = buffer.readUInt8(offset);
        offset += 1;
        if ((descriptor & 24) !== 0)
            break;
        const contentSizeFlag = descriptor >>> 6;
        const singleSegment = (descriptor & 32) !== 0;
        const checksum = (descriptor & 4) !== 0;
        const dictionaryFlag = descriptor & 3;
        const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
        const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
        const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
        if (buffer.length - offset < remainingHeaderBytes)
            break;
        offset += remainingHeaderBytes;
        let complete = true;
        for (;;) {
            if (buffer.length - offset < 3) {
                complete = false;
                break;
            }
            const blockHeader = buffer.readUIntLE(offset, 3);
            offset += 3;
            const lastBlock = (blockHeader & 1) !== 0;
            const blockType = (blockHeader >>> 1) & 3;
            const blockSize = blockHeader >>> 3;
            if (blockType === 3) {
                complete = false;
                break;
            }
            const payloadBytes = blockType === 1 ? 1 : blockSize;
            if (buffer.length - offset < payloadBytes) {
                complete = false;
                break;
            }
            offset += payloadBytes;
            if (lastBlock)
                break;
        }
        if (!complete)
            break;
        if (checksum) {
            if (buffer.length - offset < 4)
                break;
            offset += 4;
        }
        frames.push({ start, end: offset });
        if (frames.length >= maxFrames)
            break;
    }
    return frames;
}
/** Parse newline-delimited JSONL text into DSH events (packed rows expanded). */
export function parseJsonlEvents(text) {
    const events = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const decoded = decodeStorageRecord(JSON.parse(trimmed));
            events.push(...decoded);
        }
        catch {
            // The tail of a live session can end mid-JSON; ignore incomplete rows.
        }
    }
    return events;
}
/** Decompress a complete `.jsonl.zstd` file into an array of JSON events. */
export function readSessionLog(file) {
    return parseJsonlEvents(decompressSessionLogBuffer(readFileSync(file)));
}
/** Async variant of {@link readSessionLog}; yields to the event loop between frames. */
export async function readSessionLogAsync(file) {
    const buffer = await readFile(file);
    const frames = scanZstdFrames(buffer);
    const chunks = [];
    for (const frame of frames) {
        const plain = zstdDecompressSync(buffer.subarray(frame.start, frame.end));
        chunks.push(plain.toString('utf8'));
        await new Promise((resolve) => setImmediate(resolve));
    }
    // Try to recover plaintext from a still-open final frame.
    const lastEnd = frames.length > 0 ? frames[frames.length - 1].end : 0;
    if (lastEnd < buffer.length) {
        try {
            const partial = zstdDecompressSync(buffer.subarray(lastEnd), { finishFlush: constants.ZSTD_e_flush });
            chunks.push(partial.toString('utf8'));
        }
        catch {
            // ignore unreadable partial tail
        }
    }
    return parseJsonlEvents(chunks.join(''));
}
function decompressSessionLogBuffer(buffer) {
    const frames = scanZstdFrames(buffer);
    const chunks = [];
    for (const frame of frames) {
        const plain = zstdDecompressSync(buffer.subarray(frame.start, frame.end));
        chunks.push(plain.toString('utf8'));
    }
    const lastEnd = frames.length > 0 ? frames[frames.length - 1].end : 0;
    if (lastEnd < buffer.length) {
        try {
            const partial = zstdDecompressSync(buffer.subarray(lastEnd), { finishFlush: constants.ZSTD_e_flush });
            chunks.push(partial.toString('utf8'));
        }
        catch {
            // ignore unreadable partial tail
        }
    }
    return chunks.join('');
}
/** Read only the first (session header) frame quickly.
 *
 * Unlike `readSessionLog`, this avoids reading the whole append-only file: it
 * reads chunks until the first complete Zstandard frame is available.
 */
export function readSessionHeader(file) {
    const CHUNK_SIZE = 64 * 1024;
    const fd = openSync(file, 'r');
    try {
        const chunks = [];
        let total = 0;
        const scratch = Buffer.alloc(CHUNK_SIZE);
        for (;;) {
            const bytes = readSync(fd, scratch, 0, scratch.length, total);
            if (bytes <= 0)
                break;
            chunks.push(Buffer.from(scratch.subarray(0, bytes)));
            total += bytes;
            const buffer = Buffer.concat(chunks);
            const frames = scanZstdFrames(buffer, 1);
            if (frames.length > 0) {
                const plain = zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end));
                const line = plain.toString('utf8').split('\n').map((s) => s.trim()).find(Boolean);
                if (!line)
                    throw new Error(`empty session header: ${file}`);
                return JSON.parse(line);
            }
            // Safety valve: a valid header frame is tiny; never buffer the whole log.
            if (total > 4 * 1024 * 1024)
                break;
        }
        throw new Error(`empty zstd session log: ${file}`);
    }
    finally {
        closeSync(fd);
    }
}
//# sourceMappingURL=zstd.js.map