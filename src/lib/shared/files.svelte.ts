import type { SampleAsset } from "$lib/splice/types"
import { join, sep } from "@tauri-apps/api/path"
import { exists, create, mkdir } from "@tauri-apps/plugin-fs"
import { getDescrambledSampleURL } from "./store.svelte"
import { config, isSamplesDirValid } from "$lib/shared/config.svelte"
import {
    pitchShiftAudioBuffer,
    semitonesFor,
    transposeSuffix,
} from "$lib/shared/transpose.svelte"
import { encode } from "node-wav"
import { Buffer } from "buffer"

globalThis.Buffer = Buffer // node-wav needs Buffer which is not defined when using Vite

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

/**
 * Descrambles a sample and returns its decoded, trimmed WAV bytes (16-bit),
 * pitch-shifted by `semitones` (defaults to the current transpose setting).
 * Pure: does no disk I/O, so it's reused for both saving and zip export.
 */
export async function encodeSampleWav(
    sampleAsset: SampleAsset,
    semitones = semitonesFor(sampleAsset)
): Promise<Uint8Array> {
    const blobURL = await getDescrambledSampleURL(sampleAsset)

    const response = await fetch(blobURL)

    const blob = await response.blob()

    const buffer = await blob.arrayBuffer()

    const decoded = await new AudioContext().decodeAudioData(buffer)
    // Apply tempo-preserving pitch shift before trimming/encoding (no-op when 0)
    const samples = pitchShiftAudioBuffer(decoded, semitones)
    const channels: Float32Array[] = []

    for (let i = 0; i < samples.numberOfChannels; i++) {
        const channel = samples.getChannelData(i)

        // Calculate 12ms in samples based on the actual sample rate
        const trimSamples = config.cut_mp3_delay ? Math.floor(samples.sampleRate * 0.012) : 0

        const start = trimSamples
        const end = (sampleAsset.duration / 1000) * samples.sampleRate + start

        // Make sure we don't try to slice beyond the available data
        const safeEnd = Math.min(end, channel.length)

        channels.push(channel.subarray(start, safeEnd))
    }

    const wavData = encode(channels as any, {
        bitDepth: 16,
        sampleRate: samples.sampleRate,
    })

    return new Uint8Array(wavData)
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

