import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import './map-list.css'

const PAGE_SIZE = 8

/** Keep only one page mounted, even when the whole area has hundreds of pins. */
export function MapList<T>({ items, label, className, ordered = false, row }: {
  items: T[]
  label: string
  className: string
  ordered?: boolean
  row: (item: T, index: number) => ReactNode
}) {
  const [page, setPage] = useState(0)
  const pageCount = Math.ceil(items.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pageCount - 1))
  const start = currentPage * PAGE_SIZE
  const list = useRef<HTMLDivElement>(null)
  const moved = useRef(false)

  useLayoutEffect(() => {
    if (!moved.current) return
    moved.current = false
    const first = list.current?.querySelector<HTMLElement>('li button')
    first?.focus({ preventScroll: true })
    first?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  function move(delta: number) {
    moved.current = true
    setPage(currentPage + delta)
  }

  const List = ordered ? 'ol' : 'ul'
  return <div ref={list}>
    <List className={className} aria-label={label}>
      {items.slice(start, start + PAGE_SIZE).map((item, i) => row(item, start + i))}
    </List>
    {pageCount > 1 && <nav className="map-list-pages" aria-label={`${label} pages`}>
      <button type="button" disabled={currentPage === 0} aria-label={`Previous ${label.toLowerCase()}`} onClick={() => move(-1)}><ChevronLeft size={17} />Previous</button>
      <span aria-live="polite">{start + 1}–{Math.min(start + PAGE_SIZE, items.length)} of {items.length}</span>
      <button type="button" disabled={currentPage + 1 === pageCount} aria-label={`Next ${label.toLowerCase()}`} onClick={() => move(1)}>Next<ChevronRight size={17} /></button>
    </nav>}
  </div>
}
