const heights = [7, 12, 18, 10, 22, 16, 9, 14, 24, 18, 12, 8, 16, 21, 11, 18, 25, 14, 9, 17, 22, 12, 16, 8]

export function MessageWave({ progress }: { progress?: number }) {
  return <span className="message-wave" aria-hidden="true">{heights.map((height, i) => <i key={i} style={{
    height, ...(progress === undefined ? {} : { opacity: i < progress * heights.length ? 1 : .36 }),
  }} />)}</span>
}
