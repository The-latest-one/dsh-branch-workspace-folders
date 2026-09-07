/**
 * CSS Modules declarations for the vendored official ui-workspace source.
 * TypeScript has no runtime knowledge of `*.module.css`; the classes object
 * is produced by the CSS Modules pipeline at build time.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
