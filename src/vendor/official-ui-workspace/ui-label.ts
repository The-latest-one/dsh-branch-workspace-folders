/**
 * Bilingual fallback for branch-feature copy that the official `workspace`
 * locale namespace does not carry. The official ui-workspace locales are
 * loaded from the upstream package, so keys we add in our vendored copy would
 * never reach the runtime `t`; matching the former vendored client's behavior,
 * we pick by browser language instead.
 */
export function uiLabel(zh: string, en: string): string {
  return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? zh : en
}
