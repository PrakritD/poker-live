import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import CloudApp from './CloudApp.tsx'
import { load, save, type Mut } from './data.ts'
import { configuration } from './cloud.ts'
import seed from 'virtual:poker-seed'

function LocalApp() {
  const [data, setData] = useState(() => load(seed))
  useEffect(() => save(data), [data])
  const mut: Mut = fn => setData(old => { const next = structuredClone(old); fn(next); return next })
  return <><aside className="local-label">Local only · saved in this browser</aside><App data={data} mut={mut} /></>
}
const config = configuration(import.meta.env)
createRoot(document.getElementById('root')!).render(<StrictMode>{config.url && config.key ? <CloudApp url={config.url} publicKey={config.key} /> : <LocalApp />}</StrictMode>)
