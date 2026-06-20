import { SimpleFilter, SoundTouch, WebAudioBufferSource } from "soundtouchjs"

type RenderRequest = {
    id: number
    channels: Float32Array[]
    sampleRate: number
    semitones: number
    tempoRatio: number
    trimStartSeconds: number
    maxDurationSeconds: number | null
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

const BLOCK = 4096

class WorkerAudioBuffer {
    readonly length: number
    readonly numberOfChannels: number
    readonly sampleRate: number
    readonly duration: number
    private readonly channels: Float32Array[]

    constructor({
        length,
        numberOfChannels,
        sampleRate,
        channels,
    }: {
        length: number
        numberOfChannels: number
        sampleRate: number
        channels?: Float32Array[]
    }) {
        this.length = length
        this.numberOfChannels = numberOfChannels
        this.sampleRate = sampleRate
        this.duration = length / sampleRate
        this.channels =
            channels ??
            Array.from(
                { length: numberOfChannels },
                () => new Float32Array(length)
            )
    }

    getChannelData(channel: number) {
        return this.channels[channel]
    }

    copyToChannel(data: Float32Array, channel: number) {
        this.channels[channel].set(data.subarray(0, this.length))
    }

    copyFromChannel(destination: Float32Array, channel: number) {
        destination.set(
            this.channels[channel].subarray(0, destination.length)
        )
    }
}

function fromChannels(channels: Float32Array[], sampleRate: number) {
    const length = Math.min(...channels.map((channel) => channel.length))
    return new WorkerAudioBuffer({
        length,
        numberOfChannels: channels.length,
        sampleRate,
        channels: channels.map((channel) => channel.subarray(0, length)),
    })
}

function transformAudioBuffer(
    buffer: WorkerAudioBuffer,
    semitones: number,
    tempoRatio: number
): WorkerAudioBuffer {
    const shouldPitch = !!semitones
    const shouldTempo =
        Number.isFinite(tempoRatio) && Math.abs(tempoRatio - 1) >= 0.001
    if (!shouldPitch && !shouldTempo) return buffer

    const channelCount = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const originalLength = buffer.length
    const targetLength = shouldTempo
        ? Math.max(1, Math.round(originalLength / tempoRatio))
        : originalLength
    const padFrames = Math.ceil(sampleRate * 0.5)
    const padded = new WorkerAudioBuffer({
        length: originalLength + padFrames,
        numberOfChannels: channelCount,
        sampleRate,
    })

    for (let channel = 0; channel < channelCount; channel++) {
        padded.copyToChannel(buffer.getChannelData(channel), channel)
    }

    const soundtouch = new SoundTouch()
    if (shouldPitch) soundtouch.pitchSemitones = semitones
    if (shouldTempo) soundtouch.tempo = tempoRatio

    const source = new WebAudioBufferSource(padded)
    const filter = new SimpleFilter(source, soundtouch)
    const interleaved = new Float32Array(BLOCK * 2)
    const output = new WorkerAudioBuffer({
        length: targetLength,
        numberOfChannels: channelCount,
        sampleRate,
    })
    const left = output.getChannelData(0)
    const right = channelCount > 1 ? output.getChannelData(1) : null
    let writeIndex = 0
    let extracted = 0

    while (
        writeIndex < targetLength &&
        (extracted = filter.extract(interleaved, BLOCK)) > 0
    ) {
        const writable = Math.min(extracted, targetLength - writeIndex)
        for (let i = 0; i < writable; i++) {
            left[writeIndex + i] = interleaved[i * 2]
            if (right) right[writeIndex + i] = interleaved[i * 2 + 1]
        }
        writeIndex += writable
    }

    return output
}

function writeString(view: DataView, offset: number, value: string) {
    for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i))
    }
}

function encodeWav(channels: Float32Array[], sampleRate: number) {
    const channelCount = channels.length
    const frameCount = Math.min(...channels.map((channel) => channel.length))
    const bytesPerSample = 2
    const dataBytes = frameCount * channelCount * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataBytes)
    const view = new DataView(buffer)

    writeString(view, 0, "RIFF")
    view.setUint32(4, 36 + dataBytes, true)
    writeString(view, 8, "WAVE")
    writeString(view, 12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channelCount, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true)
    view.setUint16(32, channelCount * bytesPerSample, true)
    view.setUint16(34, 16, true)
    writeString(view, 36, "data")
    view.setUint32(40, dataBytes, true)

    let offset = 44
    for (let frame = 0; frame < frameCount; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][frame]))
            view.setInt16(
                offset,
                sample < 0 ? sample * 0x8000 : sample * 0x7fff,
                true
            )
            offset += bytesPerSample
        }
    }

    return new Uint8Array(buffer)
}

function renderToWav(request: RenderRequest) {
    let rendered = fromChannels(request.channels, request.sampleRate)
    rendered = transformAudioBuffer(
        rendered,
        request.semitones,
        request.tempoRatio
    )

    const trimStart = Math.min(
        rendered.length,
        Math.max(0, Math.floor(request.trimStartSeconds * rendered.sampleRate))
    )
    const maxFrames =
        request.maxDurationSeconds === null
            ? rendered.length - trimStart
            : Math.max(
                  0,
                  Math.floor(request.maxDurationSeconds * rendered.sampleRate)
              )
    const end = Math.min(rendered.length, trimStart + maxFrames)
    const channels = Array.from(
        { length: rendered.numberOfChannels },
        (_, channel) => rendered.getChannelData(channel).subarray(trimStart, end)
    )
    const wavData = encodeWav(channels, rendered.sampleRate)

    return {
        wavData,
        durationSeconds: (end - trimStart) / rendered.sampleRate,
    }
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
    const request = event.data

    try {
        const { wavData, durationSeconds } = renderToWav(request)
        const response: RenderResponse = {
            id: request.id,
            ok: true,
            wavData,
            durationSeconds,
        }
        self.postMessage(response, { transfer: [wavData.buffer] })
    } catch (err) {
        const response: RenderResponse = {
            id: request.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        }
        self.postMessage(response)
    }
}
