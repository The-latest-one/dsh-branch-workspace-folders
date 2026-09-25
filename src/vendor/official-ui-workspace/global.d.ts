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
