/** The fragment stays on the phone. Browsers omit it from requests and referrers. */
export function friendToken(input: string, origin: string): string | null {
  try {
    const url = new URL(input)
    if (url.origin !== origin || url.pathname !== '/') return null
    return /^#friend=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1] ?? null
  } catch { return null }
}

export function friendLink(token: string): string {
  return location.origin + '/#friend=' + token
}
