import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CHIPS, ink, usd, ordinal, clock, dur, lines, delta, type Session, type Line, type Event, type Who, type Player, type Leader, type Fact } from './data.ts'
import type { Payment } from './settle.ts'
import { sfx } from './audio.ts'
import { Skin, Identicon, Tag, Blocks, Figlet, Scramble, Boot, MatrixRain, CharGrid } from './Term.tsx'
import { spark, snake, candles, candleRows } from './term.ts'

export const vars = (o: Record<string, string | number>) => o as CSSProperties
// Labels: as written in Quote, snake_case in Terminal (`alt` when the terminal word differs).
const useL = () => { const t = useContext(Skin); return (s: string, alt?: string) => (t ? alt ?? snake(s) : s) } // prettier-ignore

const BANDS = [0, 0.07, 0.15, 0.4, 0.6, 0.85, 0.93, 1]
// Shared SVG gradients: striped chip edges per colour, cylinder shading.
export function ChipDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {Object.entries(CHIPS).map(([k, [face, edge]]) => (
          <linearGradient key={k} id={'edge-' + k}>
            {BANDS.slice(1).flatMap((end, i) => [BANDS[i], end].map((o, j) => <stop key={i * 2 + j} offset={o} stopColor={i % 2 ? edge : face} />))}
          </linearGradient>
        ))}
        <linearGradient id="shade">
          <stop offset="0" stopColor="#000" stopOpacity=".6" />
          <stop offset=".32" stopColor="#fff" stopOpacity=".16" />
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".65" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// Initials in a ring of the player's colour; the dashed inner ring is the chip edge. Terminal: identicon, or [AL] when `dense`.
export function Avatar({ p, dense }: { p: Player; dense?: boolean }) {
  if (useContext(Skin)) return dense ? <Tag p={p} /> : <Identicon p={p} />
  const c = ink(p.color)
  const initials = p.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <svg className="avatar" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="47" fill={c} fillOpacity=".1" stroke={c} strokeWidth="3" />
      <circle cx="50" cy="50" r="40" fill="none" stroke={c} strokeOpacity=".35" strokeWidth="4" strokeDasharray="10.47 10.47" />
      <text x="50" y="50" dy=".36em" textAnchor="middle" fill={c} fontSize={initials.length > 1 ? 30 : 36}>
        {initials}
      </text>
    </svg>
  )
}

// Side-on chip stacks, one chip per buy-in, 5 to a stack. New chips drop in; hovering the row fans them.
const R = 24, T = 15, H = 2 * R + 5 * T + 4
export function Stack({ n, color }: { n: number; color: string }) {
  const term = useContext(Skin), mounted = useRef(n).current
  if (term) return <Blocks n={n} color={color} />
  const shown = Math.min(n, 20), stacks = Math.ceil(shown / 5)
  const [face, edge] = CHIPS[color] ?? CHIPS.gray
  return (
    <svg className="stack" viewBox={`-2 0 ${stacks * 112 - 8} ${H}`} overflow="visible" aria-hidden>
      {Array.from({ length: shown }, (_, i) => {
        const x = Math.floor(i / 5) * 112, y = H - 2 - R - T * ((i % 5) + 1)
        const band = `M${x},${y} v${T} a50,${R} 0 0 0 100,0 v${-T} a50,${R} 0 0 1 -100,0z`
        return (
          <g key={i} className="drop" style={vars({ '--i': i % 5, animationDelay: i < mounted ? `${i * 45}ms` : '0ms' })}>
            <path d={band} fill={`url(#edge-${color in CHIPS ? color : 'gray'})`} />
            <path d={band} fill="url(#shade)" />
            <ellipse cx={x + 50} cy={y} rx="50" ry={R} fill={face} />
            <ellipse cx={x + 50} cy={y} rx="42" ry={R * 0.8} fill="none" stroke={edge} strokeWidth="6" strokeDasharray="12 10" />
            <ellipse cx={x + 50} cy={y} rx="30" ry={R * 0.58} fill="#fff" fillOpacity=".1" stroke={edge} strokeOpacity=".5" strokeWidth="1.5" />
          </g>
        )
      })}
      {n > shown && (
        <text x={stacks * 112} y={H - 8} className="more">
          +{n - shown}
        </text>
      )}
    </svg>
  )
}

export function Header({ night, now }: { night?: Session; now: number }) {
  const term = useContext(Skin)
  return (
    <header className="hdr">
      <div className="bar">
        {term ? (
          <span className="prompt">
            <b>dealer@felt</b>:<em>~/nights</em>$ {night && `./live --night ${snake(night.name)}`}
            <i className="caret">█</i>
          </span>
        ) : (
          <span className="brand">
            <i>♠</i>Poker Live{night && <em>{night.name}</em>}
          </span>
        )}
        {night && (
          <span className="live">
            <i />
            {term ? 'uptime ' : 'Live · '}
            {dur(now - night.startedAt)}
          </span>
        )}
        <b className="num">{clock(now)}</b>
      </div>
      {night && <Quote night={night} now={now} />}
    </header>
  )
}

// Tonight as a stock quote: money in play is the price, the session its step chart (hover for any moment).
function Quote({ night, now }: { night: Session; now: number }) {
  const [hover, setHover] = useState<number>()
  const term = useContext(Skin), L = useL()
  const pts: [number, number][] = [[night.startedAt, 0]]
  for (const e of night.events) pts.push([e.t, pts.at(-1)![1] + delta(e)])
  const ls = lines(night), t0 = night.startedAt, t1 = Math.max(now, pts.at(-1)![0] + 1), cur = pts.at(-1)![1], high = Math.max(...pts.map(p => p[1]))
  const X = (t: number) => ((t - t0) / (t1 - t0)) * 100, Y = (v: number) => 94 - (v / (high || 1)) * 80
  const d = `M0 ${Y(0)}` + pts.slice(1).map(([t, v]) => `H${X(t)}V${Y(v)}`).join('') + 'H100'
  const at = hover === undefined ? undefined : pts.findLast(p => X(p[0]) <= hover)
  return (
    <div className="quote">
      <div>
        <small>{L('In play')}</small>
        <b className="price num">{usd(cur)}</b>
        <dl>
          {[
            ['Open', clock(t0)],
            ['High', usd(high)],
            ['Volume', usd(ls.reduce((a, l) => a + l.in, 0))],
            ['Seated', `${ls.filter(l => l.seated).length}/${ls.length}`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {term ? (
        <Candles pts={pts} t0={t0} t1={t1} />
      ) : (
      <div
        className="spark"
        onPointerMove={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
        }}
        onPointerLeave={() => setHover(undefined)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="spark-fill" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={d + 'V100H0Z'} fill="url(#spark-fill)" />
          <path d={d} className="line" vectorEffect="non-scaling-stroke" />
        </svg>
        <i className="tip" style={{ top: Y(cur) + '%' }} />
        {at && hover !== undefined && (
          <span className={hover > 75 ? 'cross flip' : 'cross'} style={vars({ left: hover + '%', '--y': Y(at[1]) + '%' })}>
            <span>
              <b className="num">{usd(at[1])}</b>
              {clock(t0 + (hover / 100) * (t1 - t0))}
            </span>
          </span>
        )}
      </div>
      )}
    </div>
  )
}

// Terminal: the night as text candlesticks (green closed up, red down) over a volume row. 24 slots of 5-minute multiples.
const SLOTS = 24, ROWS = 8
function Candles({ pts, t0, t1 }: { pts: [number, number][]; t0: number; t1: number }) {
  const [hover, setHover] = useState<number>()
  const w = 3e5 * Math.ceil((t1 - t0) / SLOTS / 3e5), cs = candles(pts, t0, w, Math.ceil((t1 - t0) / w))
  const hi = Math.max(...cs.map(c => c.h)), vmax = Math.max(...cs.map(c => c.v)) || 1
  const cls = cs.map(c => (c.h === c.l ? 'flat' : c.c >= c.o ? 'win' : 'loss')), at = hover === undefined ? undefined : cs[hover]
  return (
    <div className="spark candles" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(SLOTS - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * SLOTS)))) }} onPointerLeave={() => setHover(undefined)}>
      <svg viewBox={`0 0 ${SLOTS * 2} ${ROWS + 1}`} preserveAspectRatio="none" aria-hidden>
        {candleRows(cs, ROWS, hi).flatMap((row, r) => [...row].map((ch, k) => ch !== ' ' && <text key={r * SLOTS + k} x={k * 2 + 1} y={r + 0.85} className={cls[k]}>{ch}</text>))}
        {cs.map((c, k) => c.v > 0 && <text key={'v' + k} x={k * 2 + 1} y={ROWS + 0.9} className="vol">{'▁▂▃▄▅▆▇█'[Math.ceil((c.v / vmax) * 8) - 1]}</text>)}
      </svg>
      {at && hover !== undefined && (
        <span className={hover > 15 ? 'cross flip' : 'cross'} style={{ left: ((hover * 2 + 1) / (SLOTS * 2)) * 100 + '%' }}>
          <span className="num">{`[${clock(t0 + hover * w)} o=${usd(at.o)} h=${usd(at.h)} l=${usd(at.l)} c=${usd(at.c)} vol=${usd(at.v)}]`}</span>
        </span>
      )}
    </div>
  )
}

export function LiveBoard({ night, who, flash, onPick }: { night: Session; who: Who; flash?: string; onPick: (id: string) => void }) {
  const positions = new Map((night.seats ?? []).map((id, i) => [id, i]))
  const ls = lines(night).sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity)), cols = ls.length > 8 ? 2 : 1, L = useL()
  if (!ls.length) return <div className="empty">Nobody at the table yet. Move the mouse → ＋ Player</div>
  return (
    <div className="board" style={vars({ '--cols': cols, '--rows': Math.ceil(ls.length / cols) })}>
      {ls.map((l, i) => {
        const p = who(l.id)
        return (
          <button key={l.id} className={`row glow${l.seated ? '' : ' out'}${flash === l.id ? ' flash' : ''}`} style={vars({ '--c': ink(p.color), animationDelay: `${i * 60}ms` })} onClick={() => onPick(l.id)}>
            <span className="row-in">
            <Avatar p={p} />
            <div className="who">
              <b>{p.name}</b>
              <small>{l.seated ? `${L('In since')} ${clock(l.first)}` : `${L('Cashed out')} ${usd(l.out)}`}</small>
            </div>
            <Stack n={l.buyins} color={p.color} />
            <span className="rebuys">
              {l.rebuys > 0 && (
                <>
                  <small>{L('Rebuys')}</small>×{l.rebuys}
                </>
              )}
            </span>
            <span className="money">
              <small>{l.seated ? L('In', 'money_in') : L('Net', 'net_pnl')}</small>
              <b className={l.seated ? '' : l.net >= 0 ? 'win' : 'loss'}>{l.seated ? usd(l.in) : usd(l.net, true)}</b>
            </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Terminal's right-hand panes beside the board: htop meters (money in, scaled to the biggest, load = buy-ins in the
// last 15/30/60 minutes) and a tail -f of tonight's log, the newest line typing in.
export function Side({ night, who, now }: { night: Session; who: Who; now: number }) {
  const ls = lines(night), top = Math.max(...ls.map(l => l.in), 1), W = 16, seen = new Set<string>()
  const load = [15, 30, 60].map(m => night.events.filter(e => e.type === 'buyin' && now - e.t < m * 6e4).length)
  const log = night.events.map(e => ({ e, verb: e.type !== 'buyin' ? e.type : seen.has(e.player) ? 'rebuy' : (seen.add(e.player), 'buyin') })).slice(-40)
  return (
    <aside className="side">
      <section className="pane htop" data-title="htop">
        {ls.map(l => {
          const p = who(l.id), k = Math.round((l.in / top) * W)
          return (
            <div key={l.id} className={l.seated ? '' : 'out'} style={vars({ '--c': ink(p.color) })}>
              <span className="nm">{p.name}</span>
              <span>
                [<i>{'|'.repeat(k)}</i>
                {' '.repeat(W - k)}]
              </span>
              <b className="num">{usd(l.in)}</b>
            </div>
          )
        })}
        <p>
          tasks: <b>{ls.filter(l => l.seated).length}</b> seated, {ls.filter(l => !l.seated).length} exited
        </p>
        <p>
          load average: <b>{load.join(' ')}</b>
        </p>
      </section>
      <section className="pane logp" data-title="tail -f night.log">
        <div>
        {log.map(({ e, verb }, i) => {
          const p = who(e.player), txt = `${new Date(e.t).toLocaleTimeString('en-GB')} > ${p.name}.${verb}(${usd(e.cents)})`
          return (
            <div key={e.t + e.player} className={i === log.length - 1 ? 'type' : undefined} style={vars({ '--n': txt.length, '--c': ink(p.color) })}>
              <span className="dim">{txt.slice(0, 11)}</span>
              <span style={{ color: 'var(--c)' }}>{p.name}</span>
              <span className={verb === 'cashout' ? 'win' : verb === 'rebuy' ? 'amber' : ''}>.{verb}</span>({usd(e.cents)})
            </div>
          )
        })}
        <i className="caret">█</i>
        </div>
      </section>
    </aside>
  )
}

const rank = (i: number) => String(i + 1).padStart(2, '0')

const Title = ({ kicker, title }: { kicker: string; title: string }) => (
  <div className="title">
    <small>{kicker}</small>
    <h1>{title}</h1>
  </div>
)

// All-time profit after each night, from $0.
function Trend({ pts }: { pts: number[] }) {
  const v = [0, ...pts], lo = Math.min(...v), hi = Math.max(...v), cls = v.at(-1)! >= 0 ? 'win' : 'loss'
  if (useContext(Skin)) return <span className={`trend-txt ${cls}`}>{spark(v.slice(-16))}</span>
  return (
    <svg className={`trend ${cls}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={v.map((y, i) => `${(i / (v.length - 1)) * 100},${28 - ((y - lo) / (hi - lo || 1)) * 26}`).join(' ')} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Leaders({ rows, who, nights, series }: { rows: Leader[]; who: Who; nights: number; series: Record<string, number[]> }) {
  const L = useL()
  return (
    <section className="body">
      <Title kicker={`${nights} night${nights > 1 ? 's' : ''} played`} title="All-time leaderboard" />
      <div className="lb">
        <div className="lb-row th">
          <span>#</span>
          <span />
          <span>Player</span>
          <span>Nights</span>
          <span>{L('Best night')}</span>
          <span>Streak</span>
          <span>Trend</span>
          <span>Net</span>
        </div>
        {rows.slice(0, 10).map((r, i) => (
          <div key={r.id} className={`lb-row glow r${i + 1}`} style={vars({ '--c': ink(who(r.id).color), animationDelay: `${i * 70}ms` })}>
            <span className="rank num">{rank(i)}</span>
            <Avatar p={who(r.id)} />
            <b>{who(r.id).name}</b>
            <span className="num">{r.nights}</span>
            <span className="num">{usd(r.best, true)}</span>
            <span className="num win">{r.streak > 1 ? `▲ ${r.streak}` : ''}</span>
            <Trend pts={series[r.id] ?? []} />
            <b className={`num ${r.net >= 0 ? 'win' : 'loss'}`}>{usd(r.net, true)}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

export function Facts({ items, who }: { items: Fact[]; who: Who }) {
  const L = useL()
  return (
    <section className="body">
      <Title kicker="Tonight" title="The story so far" />
      <div className="facts">
        {items.map((f, i) => (
          <div key={f.k} className="fact glow" style={vars({ '--c': f.id ? ink(who(f.id).color) : 'var(--fg)', animationDelay: `${i * 90}ms` })}>
            <small>{L(f.k)}</small>
            {f.id ? (
              <>
                <div className="fact-who">
                  <Avatar p={who(f.id)} />
                  <b>{who(f.id).name}</b>
                </div>
                <span>{f.v}</span>
              </>
            ) : (
              <b className="num big">{f.v}</b>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// Terminal: a tmux status line, the idle rotation as windows (`*` = showing) and the secret timer as just "armed".
export function Ticker({ tag, items, tabs = [], cur, armed }: { tag: string; items: string[]; tabs?: string[]; cur?: string; armed?: boolean }) {
  const seq = [...items, ...items, ...items, ...items], term = useContext(Skin)
  return (
    <div className="ticker">
      {term ? (
        <>
          <span className="tag">[poker]</span>
          {tabs.map((t, i) => (
            <span key={t} className={t === cur ? 'tab on' : 'tab'}>
              {i}:{t}
              {t === cur && '*'}
            </span>
          ))}
        </>
      ) : (
        <span className="tag">
          <i />
          {tag}
        </span>
      )}
      <div className="track-wrap">
        <div className="track" style={{ animationDuration: `${Math.max(30, items.join('').length * 0.5)}s` }}>
          {seq.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
      {term && armed && <span className="tab">⏱ armed</span>}
    </div>
  )
}

// Slides in on each buy-in / rebuy / cash-out; the bar along the bottom runs down its time on screen.
// Terminal: the event as a command typing out in a stdout box, then its exit status.
export function Toast({ e, line, p }: { e: Event; line: Line; p: Player }) {
  const re = e.type === 'buyin' && line.buyins > 1
  if (useContext(Skin)) {
    const verb = e.type === 'cashout' ? 'cashout' : re ? 'rebuy' : 'buyin'
    const rest = `.${verb}(${usd(e.cents)})${re ? `  // ${ordinal(line.rebuys)} rebuy` : ''}`
    const ok = e.type !== 'cashout' || line.net >= 0
    return (
      <div className={`toast tty ${re ? 'rebuy' : e.type}`} style={vars({ '--c': ink(p.color), '--n': p.name.length + rest.length + 2 })}>
        <Avatar p={p} />
        <div>
          <small>stdout</small>
          <code className="type cmd">
            {'> '}
            <span style={{ color: 'var(--c)' }}>{p.name}</span>
            {rest}
          </code>
          <span className={`st up ${ok ? 'win' : 'loss'}`}>
            {e.type === 'cashout' ? `[ EXIT ${ok ? 0 : 1} ] ${usd(line.net, true)}` : `[ OK ] total_in ${usd(line.in)}`}
          </span>
        </div>
      </div>
    )
  }
  const [tag, text] =
    e.type === 'cashout' ? ['Cash out', `Cashes out ${usd(e.cents)}`] : re ? ['Rebuy', `${ordinal(line.rebuys)} rebuy · ${usd(e.cents)}`] : ['Buy-in', `Buys in · ${usd(e.cents)}`]
  return (
    <div className={`toast ${re ? 'rebuy' : e.type}`} style={vars({ '--c': ink(p.color) })}>
      <Avatar p={p} />
      <div>
        <small>{tag}</small>
        <b>{p.name}</b>
        <span>{text}</span>
      </div>
      <div className="toast-num">
        <small>{e.type === 'cashout' ? 'Net' : 'Total in'}</small>
        <b className={`num ${e.type === 'cashout' ? (line.net >= 0 ? 'win' : 'loss') : ''}`}>{e.type === 'cashout' ? usd(line.net, true) : usd(line.in)}</b>
      </div>
    </div>
  )
}

// End of night: reveal results from the bottom up (drumroll for the winner), then alternate with payments.
export function Final({ night, who, pays }: { night: Session; who: Who; pays: Payment[] }) {
  const ls = lines(night).sort((a, b) => b.net - a.net)
  const [shown, setShown] = useState(0)
  const [view, setView] = useState<'results' | 'pay'>('results')
  const term = useContext(Skin), done = shown >= ls.length, champ = ls[0] && who(ls[0].id)
  useEffect(() => {
    if (shown >= ls.length) {
      const t = window.setTimeout(() => setView(v => (v === 'results' ? 'pay' : 'results')), view === 'results' ? 12e3 : 20e3)
      return () => clearTimeout(t)
    }
    const champ = shown === ls.length - 1
    if (champ) sfx.drumroll(2.2)
    const t = window.setTimeout(() => (setShown(s => s + 1), champ ? sfx.crash() : sfx.tick()), champ ? 2400 : shown ? 900 : 1400)
    return () => clearTimeout(t)
  }, [shown, view, ls.length])

  if (view === 'pay')
    return (
      <section className="body">
        <Title kicker={night.banker && night.host ? `Everyone settles with ${who(night.host).name}` : pays.length === 1 ? 'One payment settles it' : `${pays.length} payments settle it`} title="Settle up" />
        <div className="pays" style={{ fontSize: `${Math.min(2.6, 12 / Math.max(1, pays.length))}rem` }}>
          {pays.length ? (
            pays.map((p, i) => (
              <div key={i} className="pay glow" style={{ animationDelay: `${i * 120}ms` }}>
                <span className="pay-who">
                  <Avatar p={who(p.from)} />
                  {who(p.from).name}
                </span>
                <span className="pays-word">{term ? '→' : 'pays'}</span>
                <span className="pay-who">
                  <Avatar p={who(p.to)} />
                  {who(p.to).name}
                </span>
                <b className="num">{usd(p.cents)}</b>
              </div>
            ))
          ) : (
            <div className="empty">All square. Nobody owes anybody.</div>
          )}
        </div>
      </section>
    )

  return (
    <section className="body">
      {term && done && champ ? (
        <div className="title" style={vars({ '--c': ink(champ.color) })}>
          <small>{snake(night.name)} · winner</small>
          <Figlet text={champ.name} max={1.1} />
        </div>
      ) : (
        <Title kicker={night.name} title="Final results" />
      )}
      {term && !done && (
        <p className="compile num">
          compiling results… [{'█'.repeat(Math.round((shown / ls.length) * 20)).padEnd(20, '░')}] {Math.round((shown / ls.length) * 100)}%
        </p>
      )}
      <div className="results">
        {ls.map((l, i) => {
          const p = who(l.id), on = i >= ls.length - shown
          return (
            <div key={l.id} className={`res glow${on ? ' on' : ''}${i === 0 ? ' champ' : ''}`} style={vars({ '--c': ink(p.color) })}>
              <span className="rank num">{rank(i)}</span>
              <Avatar p={p} />
              <b>{term && on ? <Scramble text={p.name} /> : p.name}</b>
              <span className="dim num">
                in {usd(l.in)} · out {usd(l.out + l.adj)}
              </span>
              <b className={`num ${l.net >= 0 ? 'win' : 'loss'}`}>{term && on ? <Scramble text={usd(l.net, true)} /> : usd(l.net, true)}</b>
            </div>
          )
        })}
      </div>
      {done && (term ? champ && <MatrixRain color={ink(champ.color)} /> : <Confetti />)}
    </section>
  )
}

const CONFETTI = ['#fff', ...Object.values(CHIPS).map(c => c[2])]
function Confetti() {
  const bits = useMemo(() => Array.from({ length: 140 }, (_, i) => ({ l: Math.random() * 100, d: Math.random() * 1.8, s: 2.8 + Math.random() * 2.6, w: 0.35 + Math.random() * 0.5, r: Math.random() * 360, c: CONFETTI[i % CONFETTI.length] })), [])
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.l}%`, width: `${b.w}rem`, background: b.c, transform: `rotate(${b.r}deg)`, animationDelay: `${b.d}s`, animationDuration: `${b.s}s` }} />
      ))}
    </div>
  )
}

export function Home({ onStart, nights, players }: { onStart: () => void; nights: number; players: number }) {
  if (useContext(Skin))
    return (
      <section className="home tty">
        <Boot nights={nights} players={players} />
        <Figlet text="Poker Live" />
        <p>
          press enter or <button className="btn primary" onClick={onStart}>start tonight's game</button>
          <i className="caret">█</i>
        </p>
      </section>
    )
  return (
    <section className="home">
      <span className="mark">♠</span>
      <h1>Poker Live</h1>
      <p>Home game tracker</p>
      <button className="btn primary big" onClick={onStart}>
        Start tonight's game
      </button>
    </section>
  )
}

// A random-walk "price" across the screen; `up` = it closed higher than it opened.
function walk(y0 = 25 + Math.random() * 40) {
  let y = y0, d = `M-2 ${y0}`
  for (let x = 0.5; x <= 162; x += 2.5) d += `L${x} ${(y = Math.min(85, Math.max(5, y + (Math.random() - 0.5) * 5))).toFixed(1)}`
  return { d, up: y < y0 }
}

// Terminal bits: 20 walks from one point (Monte Carlo), a `tail -f` of tonight's log, a flickering order book.
const fan = (y0 = 35 + Math.random() * 20) => Array.from({ length: 20 }, () => walk(y0))
const SYS = ['GET /leaderboard 200 OK 4ms', 'cron: jazz.service next bar', 'GET /history.json 304', 'ws: heartbeat ok', 'gc: freed 2.1MB', 'POST /timer/arm 204', 'eval: equity 1,712,304 runouts']
const tail = (feed: string[]) => [...feed, ...SYS.map(s => `[${new Date().toLocaleTimeString('en-GB')}] ${s}`)].sort(() => Math.random() - 0.5).slice(0, 4) // ponytail: biased shuffle, fine for decoration
function book() {
  const mid = 50 + Math.random() * 400
  return Array.from({ length: 8 }, (_, i) => `${(mid + (3.5 - i) * 0.25).toFixed(2).padStart(7)} ${String(((Math.random() * 90 + 10) | 0) * 100).padStart(6)}`)
}

type Bit = { id: number; kind: string; x: number; y: number; z: number; d?: string; up?: boolean; paths?: { d: string; up: boolean }[]; txt?: string[] }
const KINDS = ['walk', 'walk', 'suit', 'ping', 'streak']
const TERM_KINDS = ['fan', 'tail', 'tail', 'book', 'streak']
let bitId = 0 // module-level: StrictMode remounts the effect while old bits are still on screen

// Background life: drifting aurora, a dot grid the cursor lights up, a trailing ring cursor that swells over
// anything clickable, a ping on every click, and every few seconds one random animation (price line, suit, ping, streak).
export function Ambient({ feed }: { feed: string[] }) {
  const [bits, setBits] = useState<Bit[]>([])
  const spot = useRef<HTMLDivElement>(null), ring = useRef<HTMLDivElement>(null)
  const term = useContext(Skin), now = useRef({ term, feed }) // for the spawn loop, registered once
  now.current = { term, feed }
  useEffect(() => setBits([]), [term]) // each theme's bits only have styles in that theme
  useEffect(() => {
    let t = 0
    const add = (b: Omit<Bit, 'id'>) => {
      const id = bitId++
      setBits(bs => [...bs.slice(-9), { ...b, id }])
    }
    const spawn = () => {
      const ks = now.current.term ? TERM_KINDS : KINDS, kind = ks[(Math.random() * ks.length) | 0], text = kind === 'tail' || kind === 'book'
      const extra = kind === 'walk' ? walk() : kind === 'fan' ? { paths: fan() } : kind === 'tail' ? { txt: tail(now.current.feed) } : kind === 'book' ? { txt: book() } : {}
      add({ kind, x: 5 + Math.random() * (text ? 55 : 90), y: 5 + Math.random() * (text ? 70 : 90), z: Math.random(), ...extra })
      t = window.setTimeout(spawn, 2500 + Math.random() * 5000)
    }
    const move = (e: PointerEvent) => {
      const el = e.target as Element
      spot.current?.style.setProperty('--mx', e.clientX + 'px')
      spot.current?.style.setProperty('--my', e.clientY + 'px')
      ring.current?.style.setProperty('translate', `${e.clientX}px ${e.clientY}px`)
      ring.current?.classList.toggle('hot', !!el.closest?.('button, label, input, select, .spark'))
      const g = el.closest?.<HTMLElement>('.glow')
      if (g) {
        const r = g.getBoundingClientRect()
        g.style.setProperty('--x', e.clientX - r.left + 'px')
        g.style.setProperty('--y', e.clientY - r.top + 'px')
      }
    }
    const down = (e: PointerEvent) => add({ kind: 'ping', x: (e.clientX / innerWidth) * 100, y: (e.clientY / innerHeight) * 100, z: 0 })
    spawn()
    addEventListener('pointermove', move)
    addEventListener('pointerdown', down)
    return () => (clearTimeout(t), removeEventListener('pointermove', move), removeEventListener('pointerdown', down))
  }, [])
  return (
    <>
      <div className="ambient" aria-hidden>
        <i className="aurora a1" />
        <i className="aurora a2" />
        <i className="aurora a3" />
        <div className="grid" />
        <div ref={spot} className="grid spot" />
        {term && <CharGrid />}
        {bits.map(b =>
          b.paths ? (
            <svg key={b.id} className="bit walk fan" viewBox="0 0 160 90" preserveAspectRatio="none">
              {b.paths.map((p, i) => (
                <path key={i} d={p.d} pathLength={1} className={p.up ? 'win' : 'loss'} />
              ))}
            </svg>
          ) : b.txt ? (
            <pre key={b.id} className={`bit ${b.kind}`} style={{ left: b.x + '%', top: b.y + '%' }}>
              {b.txt.map((t, i) => (
                <span key={i} className={b.kind === 'tail' ? 'type' : i < 4 ? 'loss' : 'win'} style={vars({ '--n': t.length, animationDelay: `${i * 0.7}s` })}>
                  {t}
                </span>
              ))}
            </pre>
          ) : b.kind === 'walk' ? (
            <svg key={b.id} className={`bit walk ${b.up ? 'win' : 'loss'}`} viewBox="0 0 160 90" preserveAspectRatio="none">
              <path d={b.d} pathLength={1} />
            </svg>
          ) : (
            <i key={b.id} className={`bit ${b.kind}`} style={vars({ left: b.x + '%', top: b.y + '%', '--z': b.z })}>
              {b.kind === 'suit' && '♠♥♦♣'[(b.z * 4) | 0]}
            </i>
          ),
        )}
      </div>
      <div ref={ring} className="ring" aria-hidden />
    </>
  )
}
