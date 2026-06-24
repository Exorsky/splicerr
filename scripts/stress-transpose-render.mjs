import { performance } from "node:perf_hooks"
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs"

class TestAudioBuffer {
    constructor({ length, numberOfChannels, sampleRate }) {
        this.length = length
        this.numberOfChannels = numberOfChannels
        this.sampleRate = sampleRate
        this.duration = length / sampleRate
        this.channels = Array.from(
            { length: numberOfChannels },
            () => new Float32Array(length)
        )
    }

    getChannelData(channel) {
        return this.channels[channel]
    }

    copyToChannel(data, channel) {
        this.channels[channel].set(data.subarray(0, this.length))
    }
}

globalThis.AudioBuffer = TestAudioBuffer

const SAMPLE_RATE = 44_100
const CHANNELS = 2
const BLOCK = 4096

function makeSyntheticSample(seconds, seed) {
    const length = Math.round(seconds * SAMPLE_RATE)
    const buffer = new AudioBuffer({
        length,
        numberOfChannels: CHANNELS,
        sampleRate: SAMPLE_RATE,
    })

    for (let channel = 0; channel < CHANNELS; channel++) {
        const data = buffer.getChannelData(channel)
        const base = 80 + seed * 23 + channel * 11
        for (let i = 0; i < length; i++) {
            const t = i / SAMPLE_RATE
            const envelope = Math.min(1, t / 0.02) * Math.max(0, 1 - t / seconds)
            data[i] =
                envelope *
                0.35 *
                (Math.sin(2 * Math.PI * base * t) +
                    0.4 * Math.sin(2 * Math.PI * (base * 2.01) * t))
        }
    }

    return buffer
}

function transformAudioBuffer(buffer, semitones, tempoRatio) {
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
    const padded = new AudioBuffer({
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
    const output = new AudioBuffer({
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

function memoryMb() {
    if (globalThis.gc) globalThis.gc()
    return process.memoryUsage().heapUsed / 1024 / 1024
}

const cases = [
    { seconds: 8, semitones: 5, tempoRatio: 1.18 },
    { seconds: 12, semitones: -4, tempoRatio: 0.86 },
    { seconds: 16, semitones: 7, tempoRatio: 1.33 },
    { seconds: 20, semitones: -2, tempoRatio: 0.74 },
    { seconds: 10, semitones: 3, tempoRatio: 1.08 },
    { seconds: 18, semitones: -5, tempoRatio: 0.92 },
]

const before = memoryMb()
const started = performance.now()
let maxCaseMs = 0
let renderedSeconds = 0

for (const [index, testCase] of cases.entries()) {
    const input = makeSyntheticSample(testCase.seconds, index + 1)
    const caseStart = performance.now()
    const stretched = transformAudioBuffer(
        input,
        testCase.semitones,
        testCase.tempoRatio
    )
    const elapsed = performance.now() - caseStart

    maxCaseMs = Math.max(maxCaseMs, elapsed)
    renderedSeconds += stretched.duration
    console.log(
        `case ${index + 1}: input=${testCase.seconds}s pitch=${testCase.semitones} tempo=${testCase.tempoRatio} output=${stretched.duration.toFixed(2)}s elapsed=${elapsed.toFixed(0)}ms`
    )
}

const totalMs = performance.now() - started
const after = memoryMb()
const memoryDelta = after - before

console.log(
    JSON.stringify(
        {
            cases: cases.length,
            renderedSeconds: Number(renderedSeconds.toFixed(2)),
            totalMs: Math.round(totalMs),
            maxCaseMs: Math.round(maxCaseMs),
            heapBeforeMb: Number(before.toFixed(1)),
            heapAfterMb: Number(after.toFixed(1)),
            heapDeltaMb: Number(memoryDelta.toFixed(1)),
        },
        null,
        2
    )
)

if (memoryDelta > 80) {
    throw new Error(`Heap grew too much: ${memoryDelta.toFixed(1)} MB`)
}

if (maxCaseMs > 10_000) {
    throw new Error(`Single render too slow: ${maxCaseMs.toFixed(0)} ms`)
}
