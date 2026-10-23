import { useEffect, useRef, useState } from 'react'
import { type Session as AuthSession } from '@supabase/supabase-js'
import { cloudClient } from './cloudClient.ts'
import QRCode from 'qrcode'
import App from './App.tsx'
import { live, usd, type Mut } from './data.ts'
import { canWrite, guestToken, saveRequest, type Group, type Snapshot, type Guest, type Result } from './cloud.ts'
import './cloud.css'

const message = (e: unknown) => e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)
const CONTEXT = 'poker-guest-return'

export default function CloudApp({ url, publicKey }: { url: string; publicKey: string }) {
  const [client] = useState(() => cloudClient(url, publicKey))
  const [auth, setAuth] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState(() => guestToken(location.hash) ?? sessionStorage.getItem(CONTEXT))
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [guest, setGuest] = useState<Guest | null>(null)
  const [loadedContext, setLoadedContext] = useState('')
  const [guestChecked, setGuestChecked] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Connecting…')
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [resultsError, setResultsError] = useState('')
  const resultsRun = useRef(false)
  const [share, setShare] = useState('')
  const [qr, setQr] = useState('')
  const [groupName, setGroupName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const current = useRef(snapshot); current.current = snapshot
  const context = `${auth?.user.id ?? ''}/${selected}/${token ?? ''}`
  const activeContext = useRef(context); activeContext.current = context
  const mounted = useRef(true)
  const isHost = !!snapshot && snapshot.owner_id === auth?.user.id

  async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const response = await client.rpc(name, args)
    if (response.error) throw response.error
    return response.data as T
  }
  async function listGroups() {
    const user = auth?.user.id
    const data = await rpc<Group[]>('poker_groups')
    if (mounted.current && user === clientUser.current) setGroups(data)
  }
  const clientUser = useRef(auth?.user.id); clientUser.current = auth?.user.id

  useEffect(() => {
    mounted.current = true
    let cancelled = false, observedAuth = false
    client.auth.getSession().then(({ data, error }) => { if (cancelled || observedAuth) return; if (error) setError(error.message); clientUser.current = data.session?.user.id; setAuth(data.session); setReady(true) })
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      observedAuth = true
      if (clientUser.current !== session?.user.id) { activeContext.current = 'auth-changing'; setSnapshot(null); setResults(null); setShowResults(false); setResultsError(''); setShare(''); setQr('') }
      clientUser.current = session?.user.id
      setAuth(session); setReady(true)
    })
    const network = () => { setOnline(navigator.onLine); if (!navigator.onLine) setStatus('Offline · last known state · recording disabled') }
    const hash = () => { const next = guestToken(location.hash); setToken(next); if (!next) sessionStorage.removeItem(CONTEXT) }
    addEventListener('online', network); addEventListener('offline', network); addEventListener('hashchange', hash)
    return () => { cancelled = true; mounted.current = false; data.subscription.unsubscribe(); removeEventListener('online', network); removeEventListener('offline', network); removeEventListener('hashchange', hash) }
  }, [client])
  useEffect(() => {
    setSnapshot(null); setSelected(''); setGroups([]); setResults(null); setShowResults(false); setResultsError('')
    if (!auth) return
    let stopped = false, running = false
    const refresh = async () => { if (stopped || running || !navigator.onLine) return; running = true; try { await listGroups() } catch (e) { if (!stopped) setError(message(e)) } finally { running = false } }
    void refresh(); const timer = setInterval(refresh, 5000)
    return () => { stopped = true; clearInterval(timer) }
  }, [auth?.user.id])
  useEffect(() => {
    setSnapshot(null); setGuest(null); setGuestChecked(false); setShare(''); setQr(''); setError(''); setNotice('')
    let stopped = false, running = false
    const captured = context
    const poll = async () => {
      if (stopped || running || lock.current || !navigator.onLine || (!token && (!auth || !selected))) return
      running = true
      try {
        if (token) {
          const data = await rpc<Guest | null>('poker_guest', { p_token: token })
          if (stopped || activeContext.current !== captured) return
          setGuest(data); setLoadedContext(captured); setGuestChecked(true)
          setStatus(data ? 'Live guest view · read only' : 'This game link has ended or was revoked')
        } else {
          const data = await rpc<Snapshot>('poker_group', { p_group_id: selected })
          if (stopped || activeContext.current !== captured) return
          setLoadedContext(captured)
          setSnapshot(old => !old || data.revision >= old.revision ? data : old)
          setStatus('Connected · private group')
        }
        setError('')
      } catch (e) {
        if (stopped || activeContext.current !== captured) return
        // A private authorization failure must not leave a revoked member's cached history visible.
        const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : ''
        if (['42501','PGRST301','PGRST302'].includes(code)) { setSnapshot(null); if (token) setGuest(null) }
        setError(message(e)); setStatus('Connection error · showing last known state · recording paused')
      } finally { running = false }
    }
    void poll(); const timer = setInterval(poll, 2500)
    return () => { stopped = true; clearInterval(timer) }
  }, [context])

  useEffect(() => {
    if (!showResults || !auth) return
    const user = auth.user.id
    let stopped = false
    const refresh = async () => {
      if (stopped || resultsRun.current || lock.current || !navigator.onLine) return
      resultsRun.current = true
      try {
        const rows = await rpc<Result[]>('poker_personal_results')
        if (!stopped && clientUser.current === user) { setResults(rows); setResultsError('') }
      } catch (e) {
        if (stopped || clientUser.current !== user) return
        const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : ''
        if (['42501','PGRST301','PGRST302'].includes(code)) setResults([])
        setResultsError('Results could not refresh. Displayed results may be out of date. ' + message(e))
      } finally { resultsRun.current = false }
    }
    void refresh(); const timer = setInterval(refresh, 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [showResults, auth?.user.id])

  async function action(work: () => Promise<void>) {
    if (lock.current || !navigator.onLine) { setError('Connect before recording changes'); return }
    const captured = activeContext.current
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { if (activeContext.current === captured) setError(message(e)) }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const mut: Mut = fn => {
    const before = current.current
    if (activeContext.current !== context || before?.id !== selected) return
    if (!before || !canWrite(before.owner_id === auth?.user.id, navigator.onLine, lock.current) || token || error) return
    const captured = activeContext.current
    const next = structuredClone(before.data)
    try { fn(next) } catch (e) { setError(message(e)); return }
    void action(async () => {
      try {
        const saved = await rpc<Snapshot>('poker_save_group', saveRequest(before.id, before.revision, next))
        if (activeContext.current === captured) { current.current = saved; setSnapshot(saved); setStatus('Saved · private group') }
      } catch (e) {
        // No optimistic state or queued retry: resolve uncertain saves/conflicts with the authoritative snapshot.
        try { const fresh = await rpc<Snapshot>('poker_group', {p_group_id:before.id}); if (activeContext.current === captured) { current.current = fresh; setSnapshot(fresh) } } catch { /* original save error remains visible */ }
        throw e
      }
    })
  }
  async function signIn() {
    if (token) sessionStorage.setItem(CONTEXT, token)
    const redirect = new URL(location.pathname, location.origin)
    const { error } = await client.auth.signInWithOAuth({provider:'google', options:{redirectTo:redirect.href}})
    if (error) setError(error.message)
  }
  function leaveGuest() { sessionStorage.removeItem(CONTEXT); history.replaceState(null, '', location.pathname + location.search); setToken(null); setGuest(null) }
  async function makeShare(rotate: boolean) {
    const s = current.current; const night = s && live(s.data); if (!s || !night) return
    const captured = activeContext.current
    const data = await rpc<{token:string}>('poker_share', {p_group_id:s.id,p_session_id:night.id,p_rotate:rotate})
    const link = new URL(location.pathname, location.origin); link.hash = `guest=${data.token}`
    const image = await QRCode.toDataURL(link.href, {width:256,margin:2})
    if (activeContext.current === captured) { setShare(link.href); setQr(image) }
  }

  return <div className="cloud-shell">
    <header className="cloud-bar">
      <strong>Poker Live</strong><span role="status">{busy ? 'Saving…' : !online ? 'Offline · recording disabled' : status}</span>
      {auth ? <><span>{auth.user.user_metadata.full_name ?? auth.user.email}</span><button disabled={busy} onClick={() => void action(async () => { const {error} = await client.auth.signOut(); if(error) throw error; setGuest(null); setSnapshot(null) })}>Sign out</button></> : <button onClick={() => void signIn()}>Sign in with Google</button>}
      {token && <button onClick={leaveGuest}>My groups</button>}
    </header>
    {error && <p role="alert" className="cloud-error">{error}</p>}
    {notice && <p role="status" className="cloud-notice">{notice}</p>}
    {auth && <details className="cloud-controls" open={!snapshot && !guest}>
      <summary>Groups &amp; personal results</summary>
      <label>Private group<select value={selected} disabled={busy} onChange={e => { leaveGuest(); setSnapshot(null); setSelected(e.target.value) }}><option value="">Choose a group</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <form onSubmit={e => { e.preventDefault(); void action(async () => { const captured = activeContext.current; const g = await rpc<Group>('poker_create_group', {p_name:groupName.trim()}); await listGroups(); if (activeContext.current === captured) { leaveGuest(); setSelected(g.id); setGroupName('') } }) }}><label>New group name<input required maxLength={100} value={groupName} onChange={e => setGroupName(e.target.value)} /></label><button disabled={busy || !online}>Create group</button></form>
      <form onSubmit={e => { e.preventDefault(); void action(async () => { const captured = activeContext.current; await rpc('poker_request_membership', {p_group_id:guest?.group_id ?? joinId.trim(),p_player_id:null}); if (activeContext.current === captured) setNotice('Membership requested. The host must approve your access and player link.') }) }}><label>Group ID to join<input required={!guest} placeholder={guest?.group_name ?? 'Ask your host for the group ID'} value={joinId} onChange={e => setJoinId(e.target.value)} /></label><button disabled={busy || !online}>Request membership</button></form>
      <button disabled={busy || !online} onClick={() => setShowResults(true)}>My results across groups</button>
      {showResults && !results && <p role="status">Loading personal results…</p>}
      {showResults && resultsError && <p role="status">{resultsError}</p>}
      {results && <div className="personal-results"><h2>My completed games</h2>{results.length ? results.map(r => <article key={`${r.group_id}/${r.session_id}`}><b>{r.group_name} · {r.session_name}</b><span>Buy-in {usd(r.buy_in)} · Cash-out {usd(r.cash_out)} · Adjustment {usd(r.adjustment)} · Net {usd(r.net,true)}</span></article>) : <p>No approved player results yet.</p>}</div>}
    </details>}
    {isHost && !token && snapshot && loadedContext === context && <details className="cloud-controls"><summary>Host · members &amp; sharing</summary>
      <p>Group ID: <code>{snapshot.id}</code></p>
      <p>Approve access and link each account to one existing player. Create players in Settings first.</p>
      {snapshot.memberships.map(m => <form className="member" key={m.user_id} onSubmit={e => {e.preventDefault(); const form = new FormData(e.currentTarget); void action(async () => { await rpc('poker_review_member',{p_group_id:snapshot.id,p_user_id:m.user_id,p_player_id:form.get('player') || null,p_approve:true}); const fresh = await rpc<Snapshot>('poker_group',{p_group_id:snapshot.id}); if(activeContext.current === context) setSnapshot(fresh) })}}>
        <span>{m.display_name} · {m.user_id === snapshot.owner_id ? 'Host' : m.status}</span><select aria-label={`Player for ${m.display_name}`} name="player" defaultValue={m.player_id ?? ''}><option value="">No player link</option>{snapshot.data.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={busy || !online}>Approve / save link</button>{m.user_id !== snapshot.owner_id && <button disabled={busy || !online} type="button" onClick={() => void action(async () => {await rpc('poker_review_member',{p_group_id:snapshot.id,p_user_id:m.user_id,p_player_id:null,p_approve:false}); const fresh = await rpc<Snapshot>('poker_group',{p_group_id:snapshot.id}); if(activeContext.current === context) setSnapshot(fresh)})}>Revoke</button>}
      </form>)}
      {live(snapshot.data) && <div className="share-controls"><button disabled={busy || !online} onClick={() => void action(() => makeShare(false))}>Show guest QR</button><button disabled={busy || !online} onClick={() => void action(() => makeShare(true))}>Rotate guest link</button><button disabled={busy || !online} onClick={() => void action(async () => {const captured = activeContext.current; await rpc('poker_revoke_share',{p_group_id:snapshot.id,p_session_id:live(snapshot.data)!.id}); if (activeContext.current === captured) { setShare(''); setQr(''); setNotice('Guest link revoked') }})}>Revoke guest link</button>{share && <div><img src={qr} alt="QR code for active game guest view" /><a href={share}>{share}</a></div>}</div>}
    </details>}
    {token ? guest && loadedContext === context ? <App key={token} data={guest.data} mut={() => {}} readOnly guest /> : <main className="cloud-welcome"><h1>{guestChecked ? 'Game unavailable' : 'Opening guest game…'}</h1><p>{guestChecked ? 'This link has ended or was revoked. Ask the host for a current QR code.' : 'Connecting to the active game.'}</p></main> : snapshot && loadedContext === context ? <App key={snapshot.id} data={snapshot.data} mut={mut} readOnly={!isHost || !online || !!error} busy={busy} shared groupName={snapshot.name} /> : <main className="cloud-welcome"><h1>Your private poker groups</h1><p>{!ready ? 'Connecting…' : auth ? 'Choose or create a group above. Shared games start empty; import your backup explicitly in Settings.' : 'Sign in with Google to create a group or request membership. Guests can open an active game QR link.'}</p></main>}
  </div>
}
