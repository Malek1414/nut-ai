export interface PlanOption {
  id: string
  name: string
  lat: number
  lng: number
  picks: Array<{ username: string; dish: string; why: string }>
  /** Map evidence only. No scanned dishes are available to match individual goals. */
  menuNote?: string
  delivery: Array<{ label: string; url: string }>
}
export interface PlanData {
  area: 'local' | 'berlin'
  options: PlanOption[]
  missingProfiles: string[]
  hasAllergies: boolean
}

export interface Person { id: string; username: string }
export interface Card {
  kind: 'restaurant' | 'menu' | 'dish'
  title: string
  subtitle?: string
  picks?: Array<{ name: string; low: number; high: number }>
  placeId?: string
  scanId?: string
  dishId?: string
  sharePath?: string
  lat?: number
  lng?: number
}
export interface Chat {
  id: string
  kind: 'direct' | 'group'
  title: string
  ownerId: string | null
  unread: number
  updatedAt: number
  lastMessage: string
}
export interface Message {
  id: number
  sender: Person | null
  type: 'text' | 'voice' | 'card' | 'plan' | 'assistant'
  text: string
  createdAt: number
  card?: Card
  plan?: PlanData
  votes?: Record<string, number>
  myVote?: string | null
  voice?: { mime: string; durationMs: number }
}
