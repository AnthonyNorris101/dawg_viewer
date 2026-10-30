export interface ElementSize {
  width: number
  height: number
}

export function observeElementSize(
  element: HTMLElement,
  onSize: (size: ElementSize) => void,
  initial: ElementSize,
): () => void {
  let last = initial
  let frame: number | null = null

  const observer = new ResizeObserver(() => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      const { clientWidth: width, clientHeight: height } = element
      if (width <= 0 || height <= 0 || (width === last.width && height === last.height)) return
      last = { width, height }
      onSize(last)
    })
  })
  observer.observe(element)

  return () => {
    observer.disconnect()
    if (frame !== null) cancelAnimationFrame(frame)
  }
}
