import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'

const seedModule = 'virtual:poker-seed'
const resolvedSeedModule = '\0' + seedModule
const emptySeed = JSON.stringify({
  players: [], sessions: [], settings: {
    defaultBuyIn: 5000, buyIns: [2500, 5000, 10000],
    denoms: { white: 100, red: 500, blue: 1000, green: 2500, black: 10000 },
    volume: 0.6, music: true, timer: { mean: 20, stdev: 5, min: 10 }, theme: 'quote',
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (Boolean(url) !== Boolean(key)) {
    throw new Error('Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for shared mode, or neither for local mode.')
  }
  if (url) {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('VITE_SUPABASE_URL must be an HTTP(S) URL.')
    if (parsed.username || parsed.password) throw new Error('VITE_SUPABASE_URL must not contain credentials.')
    let legacyAnon = false
    if (key.split('.').length === 3) {
      try { legacyAnon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon' } catch { /* Invalid JWT is not public configuration. */ }
    }
    if (!key.startsWith('sb_publishable_') && !legacyAnon) {
      throw new Error('Use a Supabase publishable key or legacy anon JWT, never a secret/service_role key.')
    }
  }
  return {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(key),
    },
    plugins: [{
      name: 'poker-seed',
      resolveId(id) { if (id === seedModule) return resolvedSeedModule },
      load(id) {
        if (id !== resolvedSeedModule) return
        // Do not even read the legacy history when producing shared assets.
        const seed = url ? emptySeed : readFileSync(new URL('./history.json', import.meta.url), 'utf8')
        return `export default ${JSON.stringify(seed)};`
      },
    }],
  }
})
