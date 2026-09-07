/**
 * Inline the tsdown-emitted `lib/style.css` into `lib/client.js` as a
 * runtime <style> tag, matching the official ui-workspace bundle layout
 * (the DSH client loads only lib/client.js; no separate stylesheet is
 * shipped or loaded). CSS module class maps stay in the JS; the CSS text
 * is injected once per module id, deduplicated via `data-plugin-css`.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'

const CSS_PATH = 'lib/style.css'
const JS_PATH = 'lib/client.js'
const PLUGIN_ID = 'dsh-branch-workspace-folders'
const CSS_ID = `${PLUGIN_ID}/style.css`

if (!existsSync(CSS_PATH)) {
  console.log('[inline-css] no lib/style.css to inline')
  process.exit(0)
}

const css = readFileSync(CSS_PATH, 'utf8')
let js = readFileSync(JS_PATH, 'utf8')

const inject = `
//#region ${PLUGIN_ID}: inlined CSS modules
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(${JSON.stringify(CSS_ID)}) + "]") === null) {
const tag = document.createElement("style");
tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};
tag.dataset.pluginCss = ${JSON.stringify(CSS_ID)};
tag.textContent = ${JSON.stringify(css)};
document.head.appendChild(tag);
}
//#endregion
`

const marker = 'var exports = module.exports;'
const idx = js.indexOf(marker)
if (idx === -1) throw new Error('[inline-css] banner marker not found in lib/client.js')
js = js.slice(0, idx + marker.length) + inject + js.slice(idx + marker.length)

writeFileSync(JS_PATH, js)
rmSync(CSS_PATH)
console.log(`[inline-css] inlined ${css.length} bytes of CSS into lib/client.js`)
