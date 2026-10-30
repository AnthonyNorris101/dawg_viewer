import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeElementSize } from './observeSize'

class ResizeObserverMock {
  static instance: ResizeObserverMock
  disconnected = false

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instance = this
  }

  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  notify() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('observeElementSize', () => {
  it('coalesces changes and ignores the current size', () => {
    let width = 800
    let height = 400
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientWidth: { get: () => width },
      clientHeight: { get: () => height },
    })

    const scheduled: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback)
      return 7
    })
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onSize = vi.fn()

    const stop = observeElementSize(host, onSize, { width, height })
    ResizeObserverMock.instance.notify()
    ResizeObserverMock.instance.notify()
    expect(requestFrame).toHaveBeenCalledOnce()

    scheduled.shift()?.(0)
    expect(onSize).not.toHaveBeenCalled()

    width = 760
    height = 380
    ResizeObserverMock.instance.notify()
    scheduled.shift()?.(0)
    expect(onSize).toHaveBeenCalledOnce()
    expect(onSize).toHaveBeenCalledWith({ width: 760, height: 380 })

    ResizeObserverMock.instance.notify()
    stop()
    expect(ResizeObserverMock.instance.disconnected).toBe(true)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
  })
})
