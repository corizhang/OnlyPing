import { z } from 'zod'
import type { AIConfig } from '@/types'

const DEFAULT_DEMO = true
const savedConfig = z.object({ baseUrl: z.string().min(1).max(2048), apiKey: z.string().max(4096), model: z.string().min(1).max(200), demo: z.boolean().default(false), keyStorage: z.enum(['session', 'local']).optional() })

export function loadAIConfig(): AIConfig & { demo: boolean } {
  try {
    const raw = localStorage.getItem('mbz-ai-config')
    if (raw) {
      const parsed = savedConfig.safeParse(JSON.parse(raw))
      if (parsed.success) {
        const config = parsed.data
        // Existing configurations keep their explicit persistent key until changed.
        const keyStorage = config.keyStorage ?? 'local'
        let apiKey = config.apiKey
        if (keyStorage === 'session') {
          try { apiKey = sessionStorage.getItem('mbz-ai-session-key') ?? '' } catch { apiKey = '' }
        }
        return { ...config, keyStorage, apiKey, demo: !apiKey || config.demo }
      }
    }
  } catch {
    /* ignore */
  }
  return {
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    model: 'moonshot-v1-8k-vision-preview',
    demo: DEFAULT_DEMO,
    keyStorage: 'session',
  }
}

export function saveAIConfig(cfg: AIConfig & { demo: boolean }) {
  const keyStorage = cfg.keyStorage ?? 'session'
  if (keyStorage === 'session') {
    // Remove any old persistent secret first, even if session storage is blocked.
    localStorage.setItem('mbz-ai-config', JSON.stringify({ ...cfg, keyStorage, apiKey: '' }))
    sessionStorage.setItem('mbz-ai-session-key', cfg.apiKey)
  } else {
    sessionStorage.removeItem('mbz-ai-session-key')
    localStorage.setItem('mbz-ai-config', JSON.stringify({ ...cfg, keyStorage }))
  }
}

