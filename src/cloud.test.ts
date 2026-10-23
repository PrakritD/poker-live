import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeImport, parseImport, guestToken, guestState, canWrite, saveRequest, emptyData } from './cloud.ts'

test('guest routing accepts only local hash token and preserves OAuth route', () => {
  assert.equal(guestToken('#guest=abc_123-XYZ'), 'abc_123-XYZ')
  assert.equal(guestToken('#guest=https://evil.test'), null)
})
test('revocation clears data while network errors preserve last known state', () => {
  const prior = { data: emptyData() }
  assert.equal(guestState(prior, null, false), null)
  assert.equal(guestState(prior, null, true), prior)
})
test('writes require connected host with no pending request', () => {
  assert.equal(canWrite(true, true, false), true)
  assert.equal(canWrite(false, true, false), false)
  assert.equal(canWrite(true, false, false), false)
  assert.equal(canWrite(true, true, true), false)
})
test('import is strict, idempotent and rejects conflicts and active game replacement', () => {
  const d = emptyData(); d.players.push({id:'p',name:'Player',color:'red'})
  assert.deepEqual(mergeImport(d, parseImport(JSON.stringify(d))), d)
  const conflict = structuredClone(d); conflict.players[0].name = 'Other'
  assert.throws(() => mergeImport(d, conflict), /conflict/i)
  d.sessions.push({ id:'n',name:'Night',startedAt:1,defaultBuyIn:5000,events:[] })
  assert.throws(() => mergeImport(d, emptyData()), /active/i)
  assert.throws(() => parseImport('{"players":[],"sessions":[],"settings":{}}'))
  const bad = emptyData(); bad.players.push({id:'p',name:'P',color:'red'}); bad.sessions.push({id:'n',name:'N',startedAt:1,defaultBuyIn:1.2,events:[]})
  assert.throws(() => parseImport(JSON.stringify(bad)))
})
test('save request carries exact revision and retains explicit retry identity', () => {
  const a = saveRequest('g', 7, emptyData(), 'receipt')
  assert.equal(a.p_expected_revision, 7)
  assert.equal(a.p_request_id, 'receipt')
  assert.deepEqual(a, saveRequest('g', 7, emptyData(), 'receipt'))
})

test('deferred import merges into the current draft and preserves intervening changes', async () => {
  const { applyImport } = await import('./cloud.ts')
  const incoming = emptyData(); incoming.players.push({id:'imported',name:'Imported',color:'red'})
  const fresh = emptyData(); fresh.players.push({id:'newer',name:'Added while reading file',color:'blue'})
  applyImport(fresh, incoming)
  assert.deepEqual(fresh.players.map(p => p.id), ['newer','imported'])
  fresh.sessions.push({id:'active',name:'New active game',startedAt:3,defaultBuyIn:5000,events:[]})
  assert.throws(() => applyImport(fresh, incoming), /active/i)
})


test('explicit legacy import accepts committed history without settings and old exports without theme', async () => {
  const { readFile } = await import('node:fs/promises')
  const legacy = parseImport(await readFile(new URL('../history.json', import.meta.url), 'utf8'))
  assert.ok(legacy.players.length > 0)
  assert.equal(legacy.settings.theme, 'quote')
  const old = emptyData(); delete (old.settings as Partial<typeof old.settings>).theme
  assert.equal(parseImport(JSON.stringify(old)).settings.theme, 'quote')
  assert.throws(() => parseImport('{"players":[],"sessions":[],"settings":{}}'))
})

test('settings saves commit complete edited names by ID while preserving a refreshed roster', async () => {
  const { applySettingsDraft } = await import('./cloud.ts')
  const base = emptyData(); base.players.push({id:'alice',name:'Alice',color:'red'},{id:'bob',name:'Bob',color:'blue'})
  const draft = structuredClone(base); draft.players[0].name = 'Alice Cooper'
  const fresh = structuredClone(base); fresh.players.reverse(); fresh.players.push({id:'carol',name:'Carol',color:'green'})
  fresh.settings.volume = 0.1
  applySettingsDraft(fresh, base, draft)
  assert.equal(fresh.players.find(p => p.id === 'alice')?.name, 'Alice Cooper')
  assert.equal(fresh.players.find(p => p.id === 'bob')?.name, 'Bob')
  assert.equal(fresh.players.at(-1)?.id, 'carol')
  assert.equal(fresh.settings.volume, 0.1)
})

test('settings three-way merge composes disjoint denomination/timer leaves', async () => {
  const { applySettingsDraft } = await import('./cloud.ts')
  const base = emptyData(), draft = structuredClone(base), current = structuredClone(base)
  draft.settings.denoms.red = 600; current.settings.denoms.blue = 1200
  draft.settings.timer.mean = 25; current.settings.timer.min = 12
  applySettingsDraft(current, base, draft)
  assert.equal(current.settings.denoms.red, 600)
  assert.equal(current.settings.denoms.blue, 1200)
  assert.equal(current.settings.timer.mean, 25)
  assert.equal(current.settings.timer.min, 12)
})
test('settings/player concurrent conflicts reject atomically, including deletion and arrays', async () => {
  const { applySettingsDraft } = await import('./cloud.ts')
  const base = emptyData(); base.players.push({id:'alice',name:'Alice',color:'red'})
  for (const field of ['name','color','delete','timer','denoms','buyIns']) {
    const draft = structuredClone(base), current = structuredClone(base)
    draft.settings.volume = 0.4 // Must not partially apply even when another field conflicts.
    if (field === 'name') { draft.players[0].name = 'Local'; current.players[0].name = 'Remote' }
    if (field === 'color') { draft.players[0].color = 'blue'; current.players[0].color = 'green' }
    if (field === 'delete') { draft.players = []; current.players[0].name = 'Remote' }
    if (field === 'timer') { draft.settings.timer.mean = 30; current.settings.timer.mean = 40 }
    if (field === 'denoms') { draft.settings.denoms.red = 600; current.settings.denoms.red = 700 }
    if (field === 'buyIns') { draft.settings.buyIns = [100]; current.settings.buyIns = [200] }
    const before = structuredClone(current)
    assert.throws(() => applySettingsDraft(current, base, draft), /conflict/i, field)
    assert.deepEqual(current, before)
  }
})
