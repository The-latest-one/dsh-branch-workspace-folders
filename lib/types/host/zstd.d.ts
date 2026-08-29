export interface ZstdFrameRange {
    start: number;
    end: number;
}
/** Walk a concatenated Zstandard stream and return complete frame ranges.
 *
 * DSH appends frames while a session is live, so the final frame is often
 * incomplete. We therefore treat any trailing partial data as end-of-file and
 * return only complete frames instead of throwing.
 */
export declare function scanZstdFrames(buffer: Buffer, maxFrames?: number): ZstdFrameRange[];
/** Parse newline-delimited JSONL text into DSH events (packed rows expanded). */
export declare function parseJsonlEvents(text: string): any[];
/** Decompress a complete `.jsonl.zstd` file into an array of JSON events. */
export declare function readSessionLog(file: string): any[];
/** Async variant of {@link readSessionLog}; yields to the event loop between frames. */
export declare function readSessionLogAsync(file: string): Promise<any[]>;
/** Read only the first (session header) frame quickly.
 *
 * Unlike `readSessionLog`, this avoids reading the whole append-only file: it
 * reads chunks until the first complete Zstandard frame is available.
 */
export declare function readSessionHeader(file: string): any;
