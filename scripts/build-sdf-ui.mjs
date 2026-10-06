import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
const source = await readFile('vendor/sdf-ui/index.css', 'utf8')
const lock = JSON.parse(await readFile('sdf-ui.lock.json', 'utf8'))
const block = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = source.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'))?.[1]
  if (!value) throw new Error(`SDF UI is missing ${selector}; review the upstream change.`)
  return value
}
const aliases = {
  navy:'color-navy', charcoal:'color-charcoal', blue:'color-blue', 'light-blue':'color-blue-light', gold:'color-gold', white:'color-white',
  canvas:'surface-page', 'surface-primary':'surface-card', 'surface-secondary':'surface-subtle', 'surface-hover':'surface-hover',
  'text-primary':'text-primary', 'text-secondary':'text-secondary', border:'border-default', 'border-strong':'border-strong',
  sidebar:'color-navy', 'sidebar-selected':'color-navy-700', 'sidebar-text':'text-on-dark', 'sidebar-muted':'color-blue-light',
  backdrop:'surface-overlay', 'focus-ring':'border-focus', danger:'status-error', success:'status-success', warning:'status-warning',
  'radius-sm':'radius-sm', 'radius-md':'radius-md', 'radius-lg':'radius-lg', shadow:'shadow-sm',
}
const bridge = Object.entries(aliases).map(([key, value]) => `  --sdf-${key}: var(--${value});`).join('\n')
await mkdir('public/sdf-ui', { recursive: true })
await writeFile('public/sdf-ui/sdf-tokens.css', `/* Generated from ${lock.repository} @ ${lock.revision}. Run pnpm ui:sync to update. */\n:root {${block('@theme')}\n${block(':root')}\n${bridge}\n  color-scheme: light;\n  --sdf-sidebar-width: 232px; --sdf-topbar-height: 56px; --sdf-page-gutter: 40px;\n  --sdf-radius-xl: 10px;\n}\n[data-theme="dark"] {${block('.dark')}\n${bridge}\n  color-scheme: dark;\n}\n@media(min-width:1600px){:root{--sdf-sidebar-width:256px;--sdf-page-gutter:48px}}\n`)
for (const file of ['sdflaw-logo-white.png', 'sdflaw-logo-black.png']) await copyFile(`vendor/sdf-ui/public/${file}`, `public/sdf-ui/${file}`)
await copyFile('vendor/sdf-ui/public/sdflaw-logo-white.png', 'public/sdf-ui/sdf-logo-report-white.png')
