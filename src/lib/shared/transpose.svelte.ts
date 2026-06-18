import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs"
import type { SampleAsset } from "$lib/splice/types"
import { config } from "$lib/shared/config.svelte"

// Semitone index (0-11) for every note spelling Splice may report.
const NOTE_INDEX: Record<string, number> = {
    C: 0,
    "C#": 1,
    DB: 1,
    D: 2,
    "D#": 3,
    EB: 3,
    E: 4,
    FB: 4,
    "E#": 5,
    F: 5,
    "F#": 6,
    GB: 6,
    G: 7,
    "G#": 8,
    AB: 8,
    A: 9,
    "A#": 10,
    BB: 10,
    B: 11,
    CB: 11,
}

// The twelve chromatic notes, spelled with flats or sharps (for the picker UI).
export const FLAT_NOTES = [
    "C",
    "Db",
    "D",
    "Eb",
    "E",
    "F",
    "Gb",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
] as const
export const SHARP_NOTES = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
] as const

function noteToIndex(note: string | null | undefined): number | null {
    if (!note) return null
    // Splice keys look like "E", "F#", "Bb" – take the leading note token.
    const token = note.trim().split(/\s+/)[0]
    const normalized =
        token.charAt(0).toUpperCase() + token.slice(1).replace(/B/gi, "b")
    const index = NOTE_INDEX[normalized.toUpperCase()]
    return index === undefined ? null : index
}

// Shortest signed distance (-5..+6) to move `fromKey` onto `toKey`.
function keyDistance(fromKey: string, toKey: string): number {
    const from = noteToIndex(fromKey)
    const to = noteToIndex(toKey)
    if (from === null || to === null) return 0
    let diff = (((to - from) % 12) + 12) % 12
    if (diff > 6) diff -= 12
    return diff
}

/**
 * How many semitones the given sample should be shifted, based on the
 * current transpose settings. Returns 0 when nothing should happen
 * (disabled, drums without a key in key-mode, already in target key, …).
 */
export function semitonesFor(sampleAsset: SampleAsset): number {
    const t = config.transpose
    if (!t.enabled) return 0
    if (t.mode === "pitch") return t.semitones
    // key mode
    if (!sampleAsset.key) return 0
    return keyDistance(sampleAsset.key, t.target_key)
}

/** A short, filesystem-friendly suffix describing the applied transpose. */
export function transposeSuffix(semitones: number): string {
    if (!semitones) return ""
    const t = config.transpose
    if (t.mode === "key") return `_${t.target_key.replace("#", "s")}`
    return `_${semitones > 0 ? "+" : ""}${semitones}st`
}

/**
 * Tempo-preserving pitch shift of an AudioBuffer using SoundTouch.
 * Returns the original buffer untouched when `semitones` is 0.
 */
export function pitchShiftAudioBuffer(
    buffer: AudioBuffer,
    semitones: number
): AudioBuffer {
    if (!semitones) return buffer

    const channelCount = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const originalLength = buffer.length

    // SoundTouch buffers ~150-350ms internally and won't flush the final window
    // unless more input follows. Pad with trailing silence so the real tail is
    // emitted, then trim the result back to the original (tempo-preserved) length.
    const padFrames = Math.ceil(sampleRate * 0.5)
    const padded = new AudioBuffer({
        length: originalLength + padFrames,
        numberOfChannels: channelCount,
        sampleRate,
    })
    for (let c = 0; c < channelCount; c++) {
        padded.copyToChannel(buffer.getChannelData(c), c)
    }

    const soundtouch = new SoundTouch()
    soundtouch.pitchSemitones = semitones

    const source = new WebAudioBufferSource(padded)
    const filter = new SimpleFilter(source, soundtouch)

    const BLOCK = 4096
    const interleaved = new Float32Array(BLOCK * 2)
    const left: number[] = []
    const right: number[] = []

    let extracted: number
    // SoundTouch always works in stereo internally; mono input is duplicated.
    while ((extracted = filter.extract(interleaved, BLOCK)) > 0) {
        for (let i = 0; i < extracted; i++) {
            left.push(interleaved[i * 2])
            right.push(interleaved[i * 2 + 1])
        }
    }

    // Trim/pad to the original length so loops stay seamless and exports keep timing.
    const output = new AudioBuffer({
        length: originalLength,
        numberOfChannels: channelCount,
        sampleRate,
    })
    const take = Math.min(left.length, originalLength)
    output.copyToChannel(Float32Array.from(left.slice(0, take)), 0)
    if (channelCount > 1) {
        output.copyToChannel(Float32Array.from(right.slice(0, take)), 1)
    }

    return output
}

/**
 * Tempo-stretches an AudioBuffer while preserving pitch. `tempoRatio` > 1 makes
 * the output shorter/faster; < 1 makes it longer/slower.
 */
export function tempoStretchAudioBuffer(
    buffer: AudioBuffer,
    tempoRatio: number
): AudioBuffer {
    if (!Number.isFinite(tempoRatio) || Math.abs(tempoRatio - 1) < 0.001) {
        return buffer
    }

    const channelCount = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const originalLength = buffer.length
    const targetLength = Math.max(1, Math.round(originalLength / tempoRatio))

    const padFrames = Math.ceil(sampleRate * 0.5)
    const padded = new AudioBuffer({
        length: originalLength + padFrames,
        numberOfChannels: channelCount,
        sampleRate,
    })
    for (let c = 0; c < channelCount; c++) {
        padded.copyToChannel(buffer.getChannelData(c), c)
    }

    const soundtouch = new SoundTouch()
    soundtouch.tempo = tempoRatio

    const source = new WebAudioBufferSource(padded)
    const filter = new SimpleFilter(source, soundtouch)

    const BLOCK = 4096
    const interleaved = new Float32Array(BLOCK * 2)
    const left: number[] = []
    const right: number[] = []

    let extracted: number
    while ((extracted = filter.extract(interleaved, BLOCK)) > 0) {
        for (let i = 0; i < extracted; i++) {
            left.push(interleaved[i * 2])
            right.push(interleaved[i * 2 + 1])
        }
        if (left.length >= targetLength + padFrames) break
    }

    const output = new AudioBuffer({
        length: targetLength,
        numberOfChannels: channelCount,
        sampleRate,
    })
    const take = Math.min(left.length, targetLength)
    output.copyToChannel(Float32Array.from(left.slice(0, take)), 0)
    if (channelCount > 1) {
        output.copyToChannel(Float32Array.from(right.slice(0, take)), 1)
    }

    return output
}
