import { useEffect, useRef, useState } from 'react'
import { live, ended, lines, facts, leaderboard, profitSeries, payments, announce, usd, roll, ink, type News, type Mut, type Who, type Data } from './data.ts'
import { unlock, setMusic, setVolume, setSkin, sfx } from './audio.ts'
import { vars, ChipDefs, Header, LiveBoard, Leaders, Facts, Ticker, Toast, Final, Home, Ambient, Side } from './Board.tsx'
import { Skin, Boot, Figlet, MatrixRain } from './Term.tsx'
import { SheetBusy, PlayerSheet, AddSheet, NewNight, LogSheet, SettleSheet, HistorySheet, SettingsSheet, SeatsSheet, EquitySheet } from './Sheets.tsx'
import './index.css'
import './terminal.css'

type SheetKind = 'add' | 'new' | 'log' | 'settle' | 'history' | 'settings' | 'seats' | 'odds'
type Open = { kind: 'player'; id: string; back?: SheetKind } | { kind: SheetKind; q?: string } | null

const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})

const PANE: Record<string, string> = { board: 'positions', leaders: 'leaderboard', facts: 'story', home: 'tty1' }

const T = ({ icon, label, on, primary, off }: { icon: string; label: string; on: () => void; primary?: boolean; off?: boolean }) => (
  <button className={primary ? 'tb primary' : 'tb'} onClick={on} disabled={off}>
    <i>{icon}</i>
    {label}
  </button>
)

export default function App({ data, mut: change, readOnly = false, guest = false, busy = false, shared = false, groupName }: { data: Data; mut: Mut; readOnly?: boolean; guest?: boolean; busy?: boolean; shared?: boolean; groupName?: string }) {
  const [sheet, setSheet] = useState<Open>(null)
  const [final, setFinal] = useState(false)
  const [awake, setAwake] = useState(true)
  const [panel, setPanel] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [third, setThird] = useState<News>()
  const [due, setDue] = useState<number>() // hidden timer: when it next goes off
  const [alarm, setAlarm] = useState<number>()
  const [rain, setRain] = useState<{ k: number; c: string }>() // Terminal: a big cash-out rains in the player's colour
  const [boot, setBoot] = useState<number>() // Terminal: boot overlay after switching to it
  const latest = useRef(data) // for window listeners registered once
  latest.current = data

  const locked = useRef(readOnly || busy)
  locked.current = readOnly || busy
  const changer = useRef(change); changer.current = change
  const mut: Mut = fn => { if (!locked.current) changer.current(fn) }
  const byId = new Map(data.players.map(p => [p.id, p]))
  const who: Who = id => byId.get(id) ?? { id, name: '?', color: 'gray' }
  const night = live(data), history = ended(data), theme = data.settings.theme, term = theme === 'terminal'
  const undo = () => mut(d => void live(d)?.events.pop())

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15e3)
    return () => clearInterval(i)
  }, [])

  // News → toast + sound, and jump to the live board.
  const prev = useRef(night)
  useEffect(() => {
    const n = announce(prev.current, night)
    prev.current = night
    if (!n) return
    setThird(n)
    setPanel(0)
    if (n.e.type === 'cashout') sfx.cashout()
    else sfx.buyin(n.line.buyins > 1)
    if (n.e.type === 'cashout' && n.line.out >= 2 * n.line.in) setRain({ k: n.e.t, c: ink(who(n.e.player).color) })
  }, [night])
  useEffect(() => {
    if (!rain) return
    const t = window.setTimeout(() => setRain(undefined), 8000)
    return () => clearTimeout(t)
  }, [rain])

  // Theme: tokens and fonts switch on <html data-theme>, sounds in audio.ts. Switching to Terminal boots it; any key or click skips.
  const shown = useRef(theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    setSkin(theme)
    if (shown.current !== theme && term) setSheet(null), setBoot(Date.now()), sfx.type(40)
    shown.current = theme
  }, [theme])
  useEffect(() => {
    if (!boot) return
    const end = () => setBoot(undefined), t = window.setTimeout(end, 3400)
    addEventListener('keydown', end)
    addEventListener('pointerdown', end)
    return () => (clearTimeout(t), removeEventListener('keydown', end), removeEventListener('pointerdown', end))
  }, [boot])
  useEffect(() => {
    if (!third) return
    const t = window.setTimeout(() => setThird(undefined), 5200)
    return () => clearTimeout(t)
  }, [third])

  useEffect(() => {
    if (!due) return
    if (!night) return setDue(undefined) // night over: the next one starts with the timer off
    const t = window.setTimeout(() => (sfx.alarm(), setAlarm(Date.now()), setDue(Date.now() + roll(data.settings.timer))), due - Date.now())
    return () => clearTimeout(t)
  }, [due, !night])
  useEffect(() => {
    if (!alarm) return
    const t = window.setTimeout(() => setAlarm(undefined), 5200)
    return () => clearTimeout(t)
  }, [alarm])

  // Mouse/keys wake the controls; 3s idle hides them and the cursor, and starts the panel rotation.
  useEffect(() => {
    let t = 0
    const poke = () => {
      setAwake(true)
      setPanel(0)
      clearTimeout(t)
      if (!matchMedia('(pointer: coarse)').matches) t = window.setTimeout(() => setAwake(false), 3000)
    }
    const evs = ['pointermove', 'pointerdown', 'keydown']
    evs.forEach(e => addEventListener(e, poke))
    poke()
    return () => (evs.forEach(e => removeEventListener(e, poke)), clearTimeout(t))
  }, [])

  const tonight = night ? facts(night, now) : []
  useEffect(() => { if (readOnly) { setSheet(s => s?.kind === 'history' || s?.kind === 'odds' ? s : null); setFinal(false) } }, [readOnly])
  const panels = (guest ? ['board'] : night ? ['board', history.length && 'leaders', tonight.length > 2 && 'facts'] : ['home', history.length && 'leaders']).filter(Boolean) as string[]
  const cur = panels[panel % panels.length]
  useEffect(() => {
    if (awake || sheet || final) return
    const t = window.setTimeout(() => setPanel(p => p + 1), 20e3)
    return () => clearTimeout(t)
  }, [awake, sheet, final, panel])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.('input, select, textarea')) return
      if (locked.current) { if (e.key === 'f' && !e.metaKey && !e.ctrlKey) fullscreen(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault(), undo()
      else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) fullscreen()
      else if (e.key === 'Enter' && !live(latest.current) && !(e.target as Element).closest?.('button, dialog')) setSheet(s => s ?? { kind: 'new' })
      // ponytail: lowercase f stays fullscreen, so a name starting with F needs Shift
      else if (/^[a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && live(latest.current)) e.preventDefault(), setSheet(s => s ?? { kind: 'add', q: e.key })
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])

  // Audio needs a user gesture; the host's first click starts it.
  useEffect(() => {
    const go = () => (unlock(), setMusic(latest.current.settings.music))
    addEventListener('pointerdown', go, { once: true })
    return () => removeEventListener('pointerdown', go)
  }, [])
  useEffect(() => setMusic(data.settings.music), [data.settings.music])
  useEffect(() => setVolume(data.settings.volume), [data.settings.volume])

  // Keep the laptop (and so the TV) awake all night.
  useEffect(() => {
    const lock = () => document.visibilityState === 'visible' && navigator.wakeLock?.request('screen').catch(() => {})
    lock()
    document.addEventListener('visibilitychange', lock)
    return () => document.removeEventListener('visibilitychange', lock)
  }, [])

  const lb = leaderboard(history)
  const ticker = [
    ...tonight.map(f => `${f.k}: ${f.id ? who(f.id).name + ' · ' : ''}${f.v}`),
    ...lb.slice(0, 3).map((r, i) => `All-time #${i + 1}: ${who(r.id).name} ${usd(r.net, true)}`),
  ]
  const feed = (night?.events ?? []).slice(-8).map(e => `[${new Date(e.t).toLocaleTimeString('en-GB')}] POST /${who(e.player).name.toLowerCase()}/${e.type} ${usd(e.cents)} 200 OK`)
  const close = () => setSheet(s => (s?.kind === 'player' && s.back ? { kind: s.back } : null))
  const props = { data, mut, who, onClose: close, shared, readOnly, groupName }

  return (
    <SheetBusy value={busy}><Skin value={term}>
    <div inert={busy} className={(awake || sheet ? 'app' : 'app sleep') + (alarm ? ' alarm' : '')}>
      <ChipDefs />
      <Ambient feed={feed} />
      <div className="stage">
        <Header night={night} now={now} />
        <main key={final ? 'final' : cur} className="panel" data-title={final ? 'results' : PANE[cur]}>
          {final && night ? (
            <Final night={night} who={who} pays={payments(night)} />
          ) : cur === 'board' && night ? (
            <LiveBoard night={night} who={who} flash={third?.e.player} onPick={id => { if (!readOnly) setSheet({ kind: 'player', id }) }} />
          ) : cur === 'leaders' ? (
            <Leaders rows={lb} who={who} nights={history.length} series={profitSeries(history)} />
          ) : cur === 'facts' ? (
            <Facts items={tonight} who={who} />
          ) : (
            <Home onStart={() => { if (!readOnly) setSheet({ kind: 'new' }) }} nights={history.length} players={data.players.length} />
          )}
        </main>
        {term && night && !final && cur === 'board' && lines(night).length <= 8 && <Side night={night} who={who} now={now} />}
        {awake || sheet ? (
          <nav className="toolbar">
            {!readOnly && (night && final ? (
              <>
                <T icon="◀" label="Back" on={() => (setFinal(false), setSheet({ kind: 'settle' }))} />
                <T icon="✓" label="Finish & save night" primary on={() => (mut(d => void (live(d)!.endedAt = Date.now())), setFinal(false))} />
              </>
            ) : night ? (
              <>
                <T icon="＋" label="Player" on={() => setSheet({ kind: 'add' })} />
                <T icon="↶" label="Undo" on={undo} off={!night.events.length} />
                <T icon="☰" label="Log" on={() => setSheet({ kind: 'log' })} />
                <T icon="■" label="End night" on={() => setSheet({ kind: 'settle' })} />
                <span className="sep" />
                <T icon="⇄" label="Seats" on={() => setSheet({ kind: 'seats' })} />
                <T icon="⏱" label={due ? 'Stop timer' : 'Timer'} on={() => setDue(due ? undefined : Date.now() + roll(data.settings.timer))} />
              </>
            ) : (
              <T icon="♠" label="New night" primary on={() => setSheet({ kind: 'new' })} />
            ))}
            <span className="sep" />
            {!guest && <T icon="★" label="History" on={() => setSheet({ kind: 'history' })} />}
            {!readOnly && <T icon="⚙" label="Settings" on={() => setSheet({ kind: 'settings' })} />}
            <T icon="%" label="Odds" on={() => setSheet({ kind: 'odds' })} />
            <span className="sep" />
            <button disabled={readOnly} className={data.settings.music ? 'tb' : 'tb muted'} onClick={() => mut(d => void (d.settings.music = !d.settings.music))} aria-label="Toggle music">
              <i>♪</i>
              {data.settings.music ? (term ? 'Synth' : 'Jazz') : 'Off'}
            </button>
            <input disabled={readOnly} type="range" min={0} max={1} step={0.05} value={data.settings.volume} aria-label="Volume" onChange={e => mut(d => void (d.settings.volume = +e.target.value))} />
            <T icon="⛶" label="Full" on={fullscreen} />
          </nav>
        ) : (
          <Ticker tag={night ? 'Tonight' : 'Poker Live'} tabs={panels} cur={cur} armed={!!due} items={ticker.length ? ticker : ['Move the mouse for controls', 'Click a player to rebuy or cash out', '⌘Z undoes', 'F for fullscreen']} />
        )}
      </div>
      {third && <Toast key={third.e.t} {...third} p={who(third.e.player)} />}
      {sheet?.kind === 'player' && night && <PlayerSheet key={sheet.id} {...props} id={sheet.id} />}
      {alarm && (
        <div key={alarm} className={term ? 'toast tty' : 'toast'} style={vars({ '--c': 'var(--amber)' })}>
          <div>
            <small>{term ? 'stderr' : 'Timer'}</small>
            <b className="up">{term ? '!! SIGALRM' : 'Time!'}</b>
            <span>{term ? 'timer fired · next one is a secret' : "Next one's a secret"}</span>
          </div>
        </div>
      )}
      {rain && term && <MatrixRain key={rain.k} color={rain.c} />}
      {boot && term && (
        <div className="boot-over" key={boot}>
          <Boot nights={history.length} players={data.players.length} />
          <Figlet text="Poker Live" />
        </div>
      )}
      {sheet?.kind === 'add' && night && <AddSheet {...props} q={sheet.q} onPick={id => { if (!readOnly) setSheet({ kind: 'player', id }) }} />}
      {sheet?.kind === 'seats' && night && <SeatsSheet {...props} />}
      {sheet?.kind === 'odds' && <EquitySheet onClose={close} />}
      {sheet?.kind === 'new' && <NewNight {...props} />}
      {sheet?.kind === 'log' && night && <LogSheet {...props} />}
      {sheet?.kind === 'settle' && night && <SettleSheet {...props} onPick={id => setSheet({ kind: 'player', id, back: 'settle' })} onReveal={() => (setSheet(null), setFinal(true))} />}
      {sheet?.kind === 'history' && <HistorySheet {...props} />}
      {sheet?.kind === 'settings' && <SettingsSheet {...props} />}
    </div>
    </Skin></SheetBusy>
  )
}
