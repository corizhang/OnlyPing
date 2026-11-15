import type { AIConfig } from '@/types'

type Config = AIConfig & { demo: boolean }
interface Host {
  readKey(): Promise<string | null>
  writeKey(key: string): Promise<void>
  readSettings(): Config
  writeSettings(config: Config): void
  clearSession(): void
}

/** Serialize hydration/migration with edits; never fall back to plaintext on error. */
export function createDesktopAIConfig(host: Host) {
  let queue: Promise<unknown> = Promise.resolve()
  let current: Config | undefined
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.catch(() => undefined).then(task)
    queue = result
    return result
  }
  return {
    load: () => enqueue(async () => {
      if (current) return current
      const config = host.readSettings()
      let apiKey = ''
      if (config.keyStorage === 'local') {
        apiKey = await host.readKey() ?? config.apiKey
        // Retain the old key until the secure store confirms migration.
        if (apiKey) await host.writeKey(apiKey)
      }
      host.writeSettings({ ...config, apiKey: '' })
      host.clearSession()
      current = { ...config, apiKey, demo: !apiKey }
      return current
    }),
    save: (config: Config) => enqueue(async () => {
      const keyStorage = config.keyStorage ?? 'session'
      // Empty key also deletes an existing credential. Session keys live in memory only.
      await host.writeKey(keyStorage === 'local' ? config.apiKey : '')
      host.writeSettings({ ...config, keyStorage, apiKey: '' })
      host.clearSession()
      current = { ...config, keyStorage }
    }),
  }
}
