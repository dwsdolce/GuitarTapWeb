// A stand-in for the browser's canvas, for tests that run the app's chart rendering under Node: a
// `document` whose canvases accept every drawing call and give back a 1×1 PNG (as a data URL or a Blob). It stands in for the
// browser, not for app code — the app's own drawing code still runs.

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function context(): unknown {
  const state: Record<string | symbol, unknown> = {}
  return new Proxy(state, {
    get(_, key) {
      if (key === 'measureText') return (s: string) => ({ width: s.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop() {} })
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      if (key in state) return state[key]
      return () => {}
    },
    set(_, key, value) {
      state[key] = value
      return true
    },
  })
}

/** Install the stand-in as the global `document`. */
export function installCanvasStandIn(): void {
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      style: {},
      getContext: () => context(),
      toDataURL: () => PNG,
      toBlob: (done: (blob: Blob) => void) => done(new Blob([Buffer.from(PNG.split(',')[1]!, 'base64')], { type: 'image/png' })),
    }),
  }
}
