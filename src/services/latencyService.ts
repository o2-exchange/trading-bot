/**
 * Singleton service that tracks API request latency using a rolling average.
 * Consumers subscribe via onChange() to receive updated latency values.
 */
class LatencyService {
  private samples: number[] = []
  private maxSamples = 10
  private listeners: Array<(latency: number) => void> = []
  private _current: number = 0

  get current(): number {
    return this._current
  }

  record(ms: number) {
    this.samples.push(ms)
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }
    this._current = Math.round(
      this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    )
    this.listeners.forEach(fn => fn(this._current))
  }

  onChange(fn: (latency: number) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn)
    }
  }
}

export const latencyService = new LatencyService()
