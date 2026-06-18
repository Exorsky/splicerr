import type { SampleAsset } from "$lib/splice/types"
import { join, sep } from "@tauri-apps/api/path"
import { exists, create, mkdir, readFile } from "@tauri-apps/plugin-fs"
import { getDescrambledSampleURL } from "./store.svelte"
import { config, isSamplesDirValid } from "$lib/shared/config.svelte"
import {
    pitchShiftAudioBuffer,
    semitonesFor,
    tempoStretchAudioBuffer,
    transposeSuffix,
} from "$lib/shared/transpose.svelte"
import { encode } from "node-wav"
import { Buffer } from "buffer"

globalThis.Buffer = Buffer // node-wav needs Buffer which is not defined when using Vite

export type DawStretchedSample = {
    path: string
    durationSeconds: number
}

const sanitizePath = (path: string) => path.replace(/[^a-zA-Z0-9#_\-\.\/]/g, "_")

// Insert a suffix (e.g. transpose tag) right before the file extension.
const withSuffix = (name: string, suffix: string) => {
    if (!suffix) return name
    const dot = name.lastIndexOf(".")
    return dot === -1
        ? name + suffix
        : name.slice(0, dot) + suffix + name.slice(dot)
}

const sampleAssetPath = (sampleAsset: SampleAsset, suffix = "") =>
    sanitizePath(
        `${sampleAsset.parents.items[0].name}/${withSuffix(sampleAsset.name, suffix)}`
    )

async function ensureFileDirectoryExists(filePath: string) {
    const separator = sep()
    const dirs = filePath.split(separator).slice(0, -1) // Remove the filename
    let currentPath = ""

    for (const dir of dirs) {
        currentPath += dir + separator
        if (!(await exists(currentPath))) {
            await mkdir(currentPath)
        }
    }
}

export async function absoluteSamplePath(sampleAsset: SampleAsset, suffix = "") {
    if (!config.samples_dir) {
        throw new Error("❌ Samples Directory not set")
    }

    if (!isSamplesDirValid()) {
        throw new Error("❌ Samples Directory invalid")
    }

    return await join(config.samples_dir, sampleAssetPath(sampleAsset, suffix))
}

function wavDurationSeconds(wavData: Uint8Array) {
    const view = new DataView(
        wavData.buffer,
        wavData.byteOffset,
        wavData.byteLength
    )

    if (
        wavData.byteLength < 44 ||
        String.fromCharCode(...wavData.subarray(0, 4)) !== "RIFF" ||
        String.fromCharCode(...wavData.subarray(8, 12)) !== "WAVE"
    ) {
        return 0
    }

    let offset = 12
    let byteRate = 0
    let dataBytes = 0

    while (offset + 8 <= wavData.byteLength) {
        const chunkId = String.fromCharCode(...wavData.subarray(offset, offset + 4))
        const chunkSize = view.getUint32(offset + 4, true)
        const chunkData = offset + 8

        if (chunkId === "fmt " && chunkData + 16 <= wavData.byteLength) {
            byteRate = view.getUint32(chunkData + 8, true)
        } else if (chunkId === "data") {
            dataBytes = chunkSize
            break
        }

        offset = chunkData + chunkSize + (chunkSize % 2)
    }

    return byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : 0
}

async function encodeSampleWavWithDuration(
    sampleAsset: SampleAsset,
    semitones = semitonesFor(sampleAsset),
    tempoRatio = 1,
    trimToMetadataDuration = true
): Promise<{ wavData: Uint8Array; durationSeconds: number }> {
    const blobURL = await getDescrambledSampleURL(sampleAsset)

    const response = await fetch(blobURL)

    const blob = await response.blob()

    const buffer = await blob.arrayBuffer()

    const decoded = await new AudioContext().decodeAudioData(buffer)
    // Apply tempo-preserving pitch shift before trimming/encoding (no-op when 0)
    const shifted = pitchShiftAudioBuffer(decoded, semitones)
    const samples = tempoStretchAudioBuffer(shifted, tempoRatio)
    console.info(
        "🎚️ Encoded sample duration",
        {
            name: sampleAsset.name,
            metadataSeconds: sampleAsset.duration / 1000,
            decodedSeconds: decoded.duration,
            renderedSeconds: samples.duration,
            trimToMetadataDuration,
        }
    )
    const channels: Float32Array[] = []

    for (let i = 0; i < samples.numberOfChannels; i++) {
        const channel = samples.getChannelData(i)

        // Calculate 12ms in samples based on the actual sample rate
        const trimSamples = config.cut_mp3_delay ? Math.floor(samples.sampleRate * 0.012) : 0

        const start = trimSamples
        const metadataDuration = (sampleAsset.duration / 1000) / tempoRatio
        const end = trimToMetadataDuration
            ? metadataDuration * samples.sampleRate + start
            : channel.length

        // Make sure we don't try to slice beyond the available data
        const safeEnd = Math.min(end, channel.length)

        channels.push(channel.subarray(start, safeEnd))
    }

    const wavData = new Uint8Array(
        encode(channels as any, {
            bitDepth: 16,
            sampleRate: samples.sampleRate,
        })
    )

    return {
        wavData,
        durationSeconds: wavDurationSeconds(wavData),
    }
}

/**
 * Descrambles a sample and returns its decoded, trimmed WAV bytes (16-bit),
 * pitch-shifted by `semitones` (defaults to the current transpose setting).
 * Pure: does no disk I/O, so it's reused for both saving and zip export.
 */
export async function encodeSampleWav(
    sampleAsset: SampleAsset,
    semitones = semitonesFor(sampleAsset),
    tempoRatio = 1,
    trimToMetadataDuration = true
): Promise<Uint8Array> {
    return (
        await encodeSampleWavWithDuration(
            sampleAsset,
            semitones,
            tempoRatio,
            trimToMetadataDuration
        )
    ).wavData
}

export async function saveSample(sampleAsset: SampleAsset) {
    const semitones = semitonesFor(sampleAsset)
    const absolutePath = await absoluteSamplePath(
        sampleAsset,
        transposeSuffix(semitones)
    )

    if (!absolutePath) {
        throw new Error("❌ Invalid path")
    }

    if (await exists(absolutePath)) {
        console.log("🗃️ Sample already exists at", absolutePath)
        return absolutePath
    }

    const wavData = await encodeSampleWav(sampleAsset, semitones)

    console.log("🏆 Sample converted! Saving at", absolutePath)

    await ensureFileDirectoryExists(absolutePath)

    const file = await create(absolutePath)
    await file.write(wavData)
    await file.close()

    console.log("🎉 Success!")

    return absolutePath
}

export async function saveDawStretchedSampleInfo(
    sampleAsset: SampleAsset,
    dawBpm: number
): Promise<DawStretchedSample> {
    const semitones = semitonesFor(sampleAsset)
    const sourceBpm = sampleAsset.bpm
    const oneShot = sampleAsset.duration <= 3000
    const tempoRatio =
        !oneShot && sourceBpm && sourceBpm > 0 && dawBpm > 0
            ? dawBpm / sourceBpm
            : 1
    const suffix = `${transposeSuffix(semitones)}_daw_full_${Math.round(dawBpm)}bpm`
    const absolutePath = await absoluteSamplePath(sampleAsset, suffix)

    if (!absolutePath) {
        throw new Error("❌ Invalid path")
    }

    if (await exists(absolutePath)) {
        console.log("🗃️ DAW-stretched sample already exists at", absolutePath)
        const wavData = await readFile(absolutePath)
        return {
            path: absolutePath,
            durationSeconds: wavDurationSeconds(wavData),
        }
    }

    const { wavData, durationSeconds } = await encodeSampleWavWithDuration(
        sampleAsset,
        semitones,
        tempoRatio,
        false
    )

    console.log("🏆 DAW-stretched sample converted! Saving at", absolutePath)

    await ensureFileDirectoryExists(absolutePath)

    const file = await create(absolutePath)
    await file.write(wavData)
    await file.close()

    console.log("🎉 DAW-stretched sample saved!")

    return { path: absolutePath, durationSeconds }
}

export async function saveDawStretchedSample(
    sampleAsset: SampleAsset,
    dawBpm: number
) {
    return (await saveDawStretchedSampleInfo(sampleAsset, dawBpm)).path
}

export async function absolutePackImagePath(sampleAsset: SampleAsset) {
    if (!config.samples_dir) {
        throw new Error("❌ Samples Directory not set")
    }

    if (!isSamplesDirValid()) {
        throw new Error("❌ Samples Directory invalid")
    }

    const pack = sampleAsset.parents.items[0]
    const packDir = sanitizePath(pack.name)
    return await join(config.samples_dir, packDir, "cover.jpg")
}

export async function savePackImage(sampleAsset: SampleAsset) {
    const pack = sampleAsset.parents.items[0]
    const packImageUrl = pack?.files[0].url

    const absolutePath = await absolutePackImagePath(sampleAsset)

    if (!absolutePath) {
        throw new Error("❌ Invalid path")
    }

    if (await exists(absolutePath)) {
        console.log("🗃️ Image already exists at", absolutePath)
        return absolutePath
    }

    try {
        const response = await fetch(packImageUrl)
        if (!response.ok) throw new Error("Failed to fetch image")
        const buffer = await response.arrayBuffer()

        console.log("🖼️ Saving pack image at", absolutePath)

        await ensureFileDirectoryExists(absolutePath)

        const file = await create(absolutePath)
        await file.write(new Uint8Array(buffer))
        await file.close()

        console.log("🎉 Pack image saved!")

        return absolutePath
    } catch (e: any) {
        console.log(e.message)
        if (e instanceof TypeError && (e.message.includes("Failed to fetch") || e.message.includes("Load failed"))) {
            console.warn("⚠️ CORS error or network issue when fetching pack image", e)
            return null
        }
        throw e
    }
}
