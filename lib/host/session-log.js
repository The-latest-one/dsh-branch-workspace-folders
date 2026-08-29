/**
 * Parse a DSH session event log into the small turn model used by the graph.
 * We deliberately keep only what a mind-map node needs: turn number, a short
 * user summary, a short assistant summary, and the turn's start/end seq.
 */
import { readSessionLog } from './zstd.js';
function textFromContent(content) {
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const item of content) {
        if (!item || typeof item !== 'object')
            continue;
        const block = item;
        if (block.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
        if (block.type === 'reasoning' && typeof block.text === 'string') {
            // Do not flood the graph with reasoning; only use it when no text block exists.
        }
    }
    return parts.join('\n').trim();
}
function summarize(text, max = 120) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= max)
        return compact;
    return compact.slice(0, max - 1) + '…';
}
export function parseSessionLog(events, header) {
    const h = header ?? events[0] ?? {};
    const turns = new Map();
    let currentTurn;
    let title = typeof h.title === 'string' ? h.title : '';
    const toolCalls = [];
    const commands = [];
    let lastActiveAt;
    for (const event of events) {
        const type = event?.type;
        const data = event?.data ?? {};
        const seq = event?.seq;
        const time = event?.time;
        if (typeof time === 'number' && (lastActiveAt === undefined || time > lastActiveAt)) {
            lastActiveAt = time;
        }
        if (type === 'session/title' && typeof data.title === 'string' && data.title) {
            title = data.title;
            continue;
        }
        if (type === 'turn/start' && typeof data.turn === 'number') {
            const turnNum = data.turn;
            currentTurn = turnNum;
            if (!turns.has(turnNum)) {
                turns.set(turnNum, {
                    turn: turnNum,
                    startSeq: seq ?? 0,
                    time,
                    userText: '',
                    assistantText: '',
                    finished: false,
                });
            }
            continue;
        }
        if (type === 'turn/end' && typeof data.turn === 'number') {
            const turn = turns.get(data.turn);
            if (turn) {
                turn.endSeq = seq;
                turn.finished = true;
            }
            continue;
        }
        if (type === 'user/message' && currentTurn !== undefined) {
            const turn = turns.get(currentTurn);
            const sourceKind = data.source?.kind;
            // Skip system/plugin notice messages; prefer the real user question.
            if (sourceKind === 'plugin' || sourceKind === 'system')
                continue;
            if (turn && !turn.userText) {
                const raw = data.content;
                const rawFallback = Array.isArray(raw)
                    ? raw.filter((item) => typeof item === 'string').join(' ')
                    : typeof raw === 'string' ? raw : '';
                turn.userText = summarize(textFromContent(raw) || rawFallback);
                turn.messageId = typeof data.id === 'string' ? data.id : turn.messageId;
            }
            continue;
        }
        if (type === 'tool/call' && typeof data.name === 'string') {
            toolCalls.push({
                name: data.name,
                arguments: typeof data.arguments === 'string' ? data.arguments : undefined,
                turn: typeof data.turn === 'number' ? data.turn : currentTurn,
            });
            continue;
        }
        if (type === 'command/run') {
            const command = typeof data.command === 'string' ? data.command
                : typeof data.name === 'string' ? data.name
                    : undefined;
            if (command) {
                commands.push({
                    command,
                    turn: typeof data.turn === 'number' ? data.turn : currentTurn,
                });
            }
            continue;
        }
        if (type === 'assistant/message' && typeof data.turn === 'number') {
            const turn = turns.get(data.turn);
            if (turn) {
                const text = textFromContent(data.message?.content);
                if (text)
                    turn.assistantText = summarize(text);
            }
        }
    }
    const turnList = [...turns.values()].sort((a, b) => a.turn - b.turn);
    return {
        sessionId: String(h.id ?? ''),
        parentId: h.parentSession ? String(h.parentSession) : undefined,
        seedLength: typeof h.seedLength === 'number' ? h.seedLength : undefined,
        origin: typeof h.origin === 'string' ? h.origin : undefined,
        cwd: typeof h.cwd === 'string' ? h.cwd : undefined,
        title,
        turns: turnList,
        maxTurn: turnList.length ? turnList[turnList.length - 1].turn : 0,
        createdAt: typeof h.createdAt === 'number' ? h.createdAt : undefined,
        toolCalls,
        commands,
        lastActiveAt,
        running: turnList.some((t) => !t.finished),
        blank: turnList.length === 0,
    };
}
export function parseSessionFile(file) {
    const events = readSessionLog(file);
    return parseSessionLog(events, events[0]);
}
//# sourceMappingURL=session-log.js.map