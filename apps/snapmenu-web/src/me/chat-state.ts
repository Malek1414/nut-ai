// Keep the current chat while switching tabs, never in disk storage.
export type Message = { role: 'user' | 'assistant'; text: string; voice?: boolean }
let current: { user: string; messages: Message[] } | null = null
export const readChat = (user: string) => current?.user === user ? current.messages : []
export const saveChat = (user: string, messages: Message[]) => { current = { user, messages } }
export const clearChat = () => { current = null }
