import { type ParsedSession } from './host/session-log.js';
export declare const name = "dsh-branch-workspace-folders";
interface DshLogger {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
}
interface DshPersistenceSession {
    id: string;
    [key: string]: unknown;
}
interface DshPersistence {
    list(): Promise<DshPersistenceSession[]>;
    locate?(header: unknown): {
        path: string;
    } | undefined;
    readFrom?(id: string, fromSeq: number): Promise<{
        meta: unknown;
        events: unknown[];
    }>;
}
interface AppContext {
    dshHomePath?: (...segments: string[]) => string;
    logger?: DshLogger;
    sessionPersistence?: DshPersistence;
    inject?: (services: string[], callback: (wctx: any) => unknown) => (() => void) | void;
    get?: (name: string) => any;
}
export interface ClusterSessionDTO {
    sessionId: string;
    parentId?: string;
    title: string;
    origin?: string;
    running?: boolean;
    blank?: boolean;
    updatedAt?: number;
    cwd?: string;
}
export interface BranchClusterDTO {
    rootSessionId: string;
    rootTitle: string;
    sessions: ClusterSessionDTO[];
}
export declare function buildClusters(parsed: ParsedSession[]): BranchClusterDTO[];
export declare function apply(ctx: AppContext): (() => void) | void;
export default apply;
