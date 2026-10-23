import { restore, live, type Data } from './data.ts'

export type Group = { id: string; name: string; owner_id: string; revision: number }
export type Member = { user_id: string; display_name: string; status: string; player_id: string | null }
export type Snapshot = Group & { data: Data; memberships: Member[] }
export type Guest = { group_id: string; group_name: string; session_id: string; revision: number; data: Data }
export type Result = { group_id: string; group_name: string; session_id: string; session_name: string; started_at: number; ended_at: number; player_id: string; buy_in: number; cash_out: number; adjustment: number; net: number }
export const configuration = (env: Record<string, string | undefined>) => ({ url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY })
export const emptyData = (): Data => restore('{"players":[],"sessions":[]}')
export function guestToken(hash: string): string | null {
  const match = /^#guest=([A-Za-z0-9_-]+)$/.exec(hash)
  return match?.[1] ?? null
}
export const guestState = <T,>(prior: T | null, next: T | null, failed: boolean): T | null => failed ? prior : next
export const canWrite = (host: boolean, online: boolean, pending: boolean) => host && online && !pending
export const saveRequest = (group: string, revision: number, data: Data, request = crypto.randomUUID()) => ({ p_group_id: group, p_expected_revision: revision, p_request_id: request, p_data: data })

// Deliberately stricter than legacy restore: cloud imports cannot silently repair malformed backups.
export function parseImport(json: string): Data {
  const d = JSON.parse(json) as Data
  if (d && typeof d === 'object') {
    if (!Object.hasOwn(d, 'settings')) d.settings = emptyData().settings
    else if (d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings) && !Object.hasOwn(d.settings, 'theme')) d.settings.theme = 'quote'
  }
  const fail = () => { throw new Error('Invalid Poker Live backup') }
  const int = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x)
  const text = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 200
  if (!d || !Array.isArray(d.players) || !Array.isArray(d.sessions) || !d.settings) fail()
  const ids = new Set<string>()
  for (const p of d.players) { if (!p || !text(p.id) || !text(p.name) || !text(p.color) || ids.has(p.id)) fail(); ids.add(p.id) }
  const nights = new Set<string>(); let active = 0
  for (const s of d.sessions) {
    if (!s || !text(s.id) || !text(s.name) || nights.has(s.id) || !int(s.startedAt) || s.startedAt < 0 || !int(s.defaultBuyIn) || s.defaultBuyIn < 0 || !Array.isArray(s.events)) fail()
    nights.add(s.id)
    if (s.endedAt !== undefined && (!int(s.endedAt) || s.endedAt < s.startedAt)) fail()
    if (s.endedAt === undefined) active++
    if (s.host !== undefined && !ids.has(s.host)) fail()
    if (s.banker !== undefined && typeof s.banker !== 'boolean') fail()
    if (s.seats && (!Array.isArray(s.seats) || new Set(s.seats).size !== s.seats.length || s.seats.some(p => !ids.has(p)))) fail()
    for (const e of s.events) if (!e || !int(e.t) || e.t < 0 || !['buyin','cashout','adjust'].includes(e.type) || !ids.has(e.player) || !int(e.cents) || (e.type !== 'adjust' && e.cents < 0)) fail()
  }
  if (active > 1) fail()
  const s = d.settings
  if (!int(s.defaultBuyIn) || s.defaultBuyIn < 0 || !Array.isArray(s.buyIns) || s.buyIns.some(x => !int(x) || x < 0) || !s.denoms || Array.isArray(s.denoms) || Object.values(s.denoms).some(x => !int(x) || x < 0) || typeof s.music !== 'boolean' || !Number.isFinite(s.volume) || s.volume < 0 || s.volume > 1 || !['quote','terminal'].includes(s.theme) || !s.timer || Object.values(s.timer).length !== 3 || ['mean','stdev','min'].some(k => !Number.isFinite(s.timer[k as keyof typeof s.timer]) || s.timer[k as keyof typeof s.timer] < 0)) fail()
  return d
}
const canonical = (v: unknown): string => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) : Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k, JSON.parse(canonical(x))])) : v)
export function mergeImport(current: Data, incoming: Data): Data {
  parseImport(JSON.stringify(incoming))
  if (live(current)) throw new Error('End the active shared game before importing')
  const merge = <T extends {id:string}>(a:T[], b:T[]) => {
    for (const item of b) { const old = a.find(x => x.id === item.id); if (old && canonical(old) !== canonical(item)) throw new Error(`Import conflict for ${item.id}`) }
    return [...a, ...b.filter(x => !a.some(y => y.id === x.id))]
  }
  return { ...current, players: merge(current.players,incoming.players), sessions: merge(current.sessions,incoming.sessions) }
}

// Evaluate the merge against the authoritative draft at mutation time, after file IO.
export function applyImport(draft: Data, incoming: Data): void {
  Object.assign(draft, mergeImport(draft, incoming))
}

// Three-way merge uses the actual current state, retaining disjoint remote edits.
// Arrays are a single field; nested denomination/timer objects merge by leaf.
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function mergeField(base: unknown, current: unknown, draft: unknown, path: string): unknown {
  if (equal(draft, base)) return structuredClone(current)
  if (equal(current, base) || equal(current, draft)) return structuredClone(draft)
  if (object(base) && object(current) && object(draft)) {
    const result: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(draft)])) {
      const value = mergeField(base[key], current[key], draft[key], `${path}.${key}`)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  throw new Error(`Settings conflict at ${path}. Another device changed this field. Close Settings and reopen to review the current value before saving again.`)
}
export function applySettingsDraft(target: Data, base: Data, draft: Data): void {
  const settings = mergeField(base.settings, target.settings, draft.settings, 'settings') as Data['settings']
  const players = structuredClone(target.players)
  for (const id of new Set([...base.players.map(p => p.id), ...draft.players.map(p => p.id)])) {
    const prior = base.players.find(p => p.id === id)
    const edited = draft.players.find(p => p.id === id)
    const index = players.findIndex(p => p.id === id)
    const merged = mergeField(prior, players[index], edited, `players.${id}`) as Data['players'][number] | undefined
    if (merged === undefined) { if (index >= 0) players.splice(index, 1) }
    else if (index < 0) players.push(merged)
    else players[index] = merged
  }
  // Publish only after every field validates; a conflict leaves the target intact.
  target.settings = settings
  target.players = players
}
