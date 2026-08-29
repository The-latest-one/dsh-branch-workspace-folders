import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'lib/types/client')
mkdirSync(outDir, { recursive: true })

const dts = `/**
 * dsh-branch-workspace-folders — browser half public types.
 */
export declare const name = 'dsh-branch-workspace-folders';
export declare const inject: string[];
/** Install the sidebar workspace branch-folders view. */
export declare function apply(ctx: any): void;
`
writeFileSync(join(outDir, 'index.d.ts'), dts)
