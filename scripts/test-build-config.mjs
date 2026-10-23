import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadConfigFromFile } from 'vite'

const load = async () => (await loadConfigFromFile({ command: 'build', mode: 'production' })).config
const set = (url, key) => {
  process.env.VITE_SUPABASE_URL = url
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = key
}
const seed = async () => {
  const c = await load()
  const p = c.plugins.find(p => p.name === 'poker-seed')
  const id = p.resolveId('virtual:poker-seed')
  assert.equal(id, '\0virtual:poker-seed')
  return JSON.parse(p.load(id).slice('export default '.length, -1))
}
const jwt = role => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
const failures = [
  ['https://example.supabase.co', '', /Set both/],
  ['', 'sb_publishable_test', /Set both/],
  ['https://user:password@example.supabase.co', 'sb_publishable_test', /credentials/],
  ['https://example.supabase.co', 'sb_secret_test', /publishable key/],
  ['https://example.supabase.co', jwt('service_role'), /publishable key/],
  ['ftp://example.supabase.co', 'sb_publishable_test', /HTTP\(S\)/],
  ['https://example.supabase.co', 'malformed', /publishable key/],
]
for (const [url, key, error] of failures) { set(url, key); await assert.rejects(load, error) }
set('', '')
assert.equal(await seed(), readFileSync('history.json', 'utf8'))
for (const key of ['sb_publishable_browser_test', jwt('anon')]) {
  set('https://example.supabase.co', key)
  const shared = JSON.parse(await seed())
  assert.deepEqual(shared.players, [])
  assert.deepEqual(shared.sessions, [])
  assert.equal(shared.settings.theme, 'quote')
}
const fixture = mkdtempSync(join(tmpdir(), 'poker-build-privacy-'))
try {
  writeFileSync(join(fixture, 'check.js'), 'const clean = true;')
  const scan = () => spawnSync(process.execPath, ['scripts/check-cloud-privacy.mjs', fixture], { encoding: 'utf8' })
  assert.equal(scan().status, 0)
  const player = JSON.parse(readFileSync('history.json', 'utf8')).players[0]
  writeFileSync(join(fixture, 'check.js'), `const leakedSeed = ${JSON.stringify(player.id)};`)
  const leaked = scan()
  assert.notEqual(leaked.status, 0)
  assert.match(leaked.stderr, /Legacy seed marker/)
} finally { rmSync(fixture, { recursive: true, force: true }) }
console.log('Build configuration and privacy scanner regression checks passed')
