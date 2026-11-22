import { AiError } from './ai-error.js'

type Block = { type: string; text?: string; source?: { media_type: string; data: string } }
type Message = { role: string; content: string | Block[] }
type Reply = { choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }> }

/** Translate the app's existing text/image prompts and schemas without changing their meaning. */
export async function createOpenAI(apiKey: string | undefined, params: Record<string, unknown>) {
  if (!apiKey) throw new AiError('The AI key is not configured on the server.', 503, 'no_key')
  const system = typeof params['system'] === 'string' ? params['system'] : (params['system'] as Block[] | undefined)?.map(b => b.text ?? '').join('\n')
  const messages = (params['messages'] as Message[]).map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map(b => b.type === 'image' && b.source
      ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
      : { type: 'text', text: b.text ?? '' }),
  }))
  const schema = (params['output_config'] as { format?: { schema?: object } } | undefined)?.format?.schema
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: params['model'],
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        max_completion_tokens: params['max_tokens'],
        ...(String(params['model']).startsWith('gpt-5') ? { reasoning_effort: 'none' } : {}),
        ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'platepal', strict: true, schema } } } : {}),
        store: false,
      }),
    })
  } catch {
    throw new AiError('Could not reach the AI service.', 504, 'connection')
  }
  // No automatic retries: a failed request must not cause another paid call.
  if (!res.ok) {
    await res.body?.cancel()
    if (res.status === 401 || res.status === 403) throw new AiError('The AI key was rejected.', 502, 'auth')
    if (res.status === 429) throw new AiError('The AI service is busy right now.', 503, 'rate_limited')
    if (res.status === 400 || res.status === 404) throw new AiError('The AI request configuration was rejected.', 502, 'bad_request')
    throw new AiError(`AI service error (${res.status}).`, 502, 'api')
  }
  let reply: Reply
  try { reply = await res.json() as Reply } catch { throw new AiError('We could not read the AI answer.', 502, 'parse') }
  const choice = reply?.choices?.[0]
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new AiError('The AI declined this request.', 422, 'refusal')
  if (choice?.finish_reason === 'length') throw new AiError('The AI answer was cut short. Try a smaller menu.', 502, 'parse')
  const text = choice?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new AiError('The AI returned no answer.', 502, 'empty')
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}
