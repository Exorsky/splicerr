type RenderAudioOptions = {
    semitones: number
    tempoRatio: number
    trimStartSeconds: number
    maxDurationSeconds: number | null
    signal?: AbortSignal
}

type WorkerRenderAudioOptions = Omit<RenderAudioOptions, "signal">

type RenderRequest = WorkerRenderAudioOptions & {
    id: number
    channels: Float32Array[]
    sampleRate: number
}

type RenderResponse =
    | {
          id: number
          ok: true
          wavData: Uint8Array
          durationSeconds: number
      }
    | {
          id: number
          ok: false
          error: string
      }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
    number,
    {
        resolve: (value: { wavData: Uint8Array; durationSeconds: number }) => void
        reject: (reason?: unknown) => void
    }
>()

function abortError() {
    return new DOMException("Audio render cancelled", "AbortError")
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw abortError()
    }
}

function nextFrame() {
    return new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve())
    })
}

async function copyAudioBufferChannels(
    buffer: AudioBuffer,
    signal?: AbortSignal
) {
    const channels = Array.from(
        { length: buffer.numberOfChannels },
        () => new Float32Array(buffer.length)
    )
    const chunkFrames = 262_144

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel)
        const destination = channels[channel]

        for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
            throwIfAborted(signal)
            const end = Math.min(buffer.length, offset + chunkFrames)
            destination.set(source.subarray(offset, end), offset)
            await nextFrame()
        }
    }

    throwIfAborted(signal)
    return channels
}

function getWorker() {
    if (worker) return worker

    worker = new Worker(new URL("./audio-render-worker.ts", import.meta.url), {
        type: "module",
    })

    worker.onmessage = (event: MessageEvent<RenderResponse>) => {
        const response = event.data
        const request = pending.get(response.id)
        if (!request) return

        pending.delete(response.id)
        if (response.ok) {
            request.resolve({
                wavData: response.wavData,
                durationSeconds: response.durationSeconds,
            })
        } else {
            request.reject(new Error(response.error))
        }
    }

    worker.onerror = (event) => {
        for (const request of pending.values()) {
            request.reject(
                new Error(event.message || "Audio render worker failed")
            )
        }
        pending.clear()
        worker?.terminate()
        worker = null
    }

    return worker
}

export function cancelAudioRenderWorker() {
    if (!worker) return

    for (const request of pending.values()) {
        request.reject(abortError())
    }
    pending.clear()
    worker.terminate()
    worker = null
}

export async function renderAudioBufferToWav(
    buffer: AudioBuffer,
    options: RenderAudioOptions
) {
    throwIfAborted(options.signal)
    const id = nextId++
    const channels = await copyAudioBufferChannels(buffer, options.signal)
    const transfer = channels.map((channel) => channel.buffer)
    const { signal: _signal, ...workerOptions } = options

    return new Promise<{ wavData: Uint8Array; durationSeconds: number }>(
        (resolve, reject) => {
            if (options.signal?.aborted) {
                reject(abortError())
                return
            }

            pending.set(id, {
                resolve: (value) => {
                    if (options.signal?.aborted) {
                        reject(abortError())
                    } else {
                        resolve(value)
                    }
                },
                reject: (reason) => {
                    reject(reason)
                },
            })
            const request: RenderRequest = {
                id,
                channels,
                sampleRate: buffer.sampleRate,
                ...workerOptions,
            }

            try {
                getWorker().postMessage(request, { transfer })
            } catch (err) {
                pending.delete(id)
                reject(err)
            }
        }
    )
}
