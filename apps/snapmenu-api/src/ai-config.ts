import { modelSettings } from './models.js'
import type { Ai } from './anthropic.js'

export type AiProvider = 'openai' | 'anthropic'
export interface AiEnv {
  AI_PROVIDER?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BASE_URL?: string
  MODEL_READ?: string
  MODEL_VOICE?: string
}

/** One provider per request. Never send a key, image or failed request to the other provider. */
export function aiSettings(env: AiEnv): Ai {
  if (env.AI_PROVIDER === 'anthropic') return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, ...modelSettings(env) }
  const model = env.OPENAI_MODEL?.trim() || 'gpt-5.4-mini'
  return { provider: 'openai', apiKey: env.OPENAI_API_KEY, read: model, voice: model }
}
