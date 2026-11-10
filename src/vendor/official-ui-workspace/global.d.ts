/**
 * CSS Modules and locale declarations for the vendored official ui-workspace source.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    workspace: any
  }
}

declare module '@deepseek-ai/dsh-client-ui-context-menu/client' {
  export interface ContextMenuTarget {
    kind: string
    value: any
  }
  export interface ContextMenuTargetMap {
    [key: string]: any
  }
}
