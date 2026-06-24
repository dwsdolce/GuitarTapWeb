// AudioWorklet processor — intentionally minimal. It accumulates mono input into
// 1024-sample chunks (the app's chunk granularity) and posts each chunk plus its
// RMS to the main thread, where the tested src/dsp core runs. Keeping it tiny and
// dependency-free means it needs no bundling and the DSP stays in one validated
// place. The global `sampleRate` here is the AudioContext's actual rate.
class SpectrumProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.CHUNK = 1024
    this.buf = new Float32Array(this.CHUNK)
    this.idx = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buf[this.idx++] = channel[i]
        if (this.idx >= this.CHUNK) {
          let sumSq = 0
          for (let k = 0; k < this.CHUNK; k++) sumSq += this.buf[k] * this.buf[k]
          const rms = Math.sqrt(sumSq / this.CHUNK)
          // Transfer a copy so the main thread owns the buffer.
          const out = this.buf.slice()
          this.port.postMessage({ samples: out, rms }, [out.buffer])
          this.idx = 0
        }
      }
    }
    return true // keep the processor alive (writes no output → silent)
  }
}

registerProcessor('spectrum-processor', SpectrumProcessor)
