export interface ParsedTurn {
    turn: number;
    startSeq: number;
    endSeq?: number;
    time?: number;
    userText: string;
    assistantText: string;
    messageId?: string;
    finished: boolean;
}
export interface ParsedToolCall {
    name: string;
    arguments?: string;
    turn?: number;
}
export interface ParsedCommand {
    command: string;
    turn?: number;
}
export interface ParsedSession {
    sessionId: string;
    parentId?: string;
    seedLength?: number;
    origin?: string;
    cwd?: string;
    title: string;
    turns: ParsedTurn[];
    maxTurn: number;
    createdAt?: number;
    toolCalls?: ParsedToolCall[];
    commands?: ParsedCommand[];
    lastActiveAt?: number;
    running?: boolean;
    blank?: boolean;
}
export declare function parseSessionLog(events: any[], header?: any): ParsedSession;
export declare function parseSessionFile(file: string): ParsedSession;
