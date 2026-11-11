import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const isNarrow = () => window.innerWidth < MOBILE_BREAKPOINT
// The server can't know the viewport; "not mobile" matches what the hook
// returned before its first effect ran.
const onServer = () => false

/** The viewport is an outside source, so the hook subscribes to it. */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isNarrow, onServer)
}
