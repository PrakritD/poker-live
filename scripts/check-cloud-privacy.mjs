// Run after a configured cloud build. Check every emitted file, including source maps.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const history = JSON.parse(readFileSync(new URL('../history.json', import.meta.url), 'utf8'))
const markers = new Set([
  ...history.players.flatMap(player => [player.id, player.name]),
  ...history.sessions.map(session => session.id),
].filter(value => typeof value === 'string' && value.length >= 4))
assert(markers.size > 0, 'No legacy seed markers found; privacy check needs a fixture')
function files(path) {
  return readdirSync(path).flatMap(name => {
    const child = join(path, name)
    return statSync(child).isDirectory() ? files(child) : [child]
  })
}
const assets = files(process.argv[2] ?? 'dist')
assert(assets.some(path => path.endsWith('.js')), 'No built JavaScript to inspect')
for (const path of assets) {
  const text = readFileSync(path, 'utf8')
  assert(!path.endsWith('history.json'), `Legacy history asset emitted: ${path}`)
  for (const marker of markers) {
    assert(!text.includes(marker), `Legacy seed marker ${JSON.stringify(marker)} found in ${path}`)
  }
}
console.log(`Cloud privacy check passed: ${assets.length} files, ${markers.size} legacy markers absent`)
