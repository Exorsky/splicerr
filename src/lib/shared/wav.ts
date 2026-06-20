import { encode } from "node-wav"
import { Buffer } from "buffer"

globalThis.Buffer = Buffer // node-wav needs Buffer which is not defined when using Vite

let sharedContext: AudioContext | null = null
const audioContext = () => (sharedContext ??= new AudioContext())

type DecodeOptions = {
    isolatedContext?: boolean
    signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("Audio decode cancelled", "AbortError")
    }
}

/** Decode an (already descrambled) audio blob URL into an AudioBuffer. */
export async function decodeAudioFromURL(
    url: string,
    options: DecodeOptions = {}
): Promise<AudioBuffer> {
    throwIfAborted(options.signal)
    const response = await fetch(url)
    throwIfAborted(options.signal)
    const arrayBuffer = await response.arrayBuffer()
    return await decodeAudioFromArrayBuffer(arrayBuffer, options)
}

/** Decode audio bytes. Use an isolated context for one-off heavy renders. */
export async function decodeAudioFromArrayBuffer(
    arrayBuffer: ArrayBuffer,
    options: DecodeOptions = {}
): Promise<AudioBuffer> {
    throwIfAborted(options.signal)
    const context = options.isolatedContext ? new AudioContext() : audioContext()

    try {
        const decoded = await context.decodeAudioData(arrayBuffer)
        throwIfAborted(options.signal)
        return decoded
    } finally {
        if (options.isolatedContext) {
            void context.close().catch(() => undefined)
        }
    }
}

/** Encode an AudioBuffer to 16-bit PCM WAV bytes. */
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
    const channels: Float32Array[] = []
    for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i))
    }
    const wavData = encode(channels as any, {
        sampleRate: buffer.sampleRate,
        bitDepth: 16,
    })
    return new Uint8Array(wavData)
}
