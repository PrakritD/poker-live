import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// React StrictMode may run initializers twice. Reuse one auth client per configuration.
const clients = new Map<string, SupabaseClient>()
export function cloudClient(url: string, publicKey: string): SupabaseClient {
  const config = JSON.stringify([url, publicKey])
  let client = clients.get(config)
  if (!client) { client = createClient(url, publicKey); clients.set(config, client) }
  return client
}
