import type { SampleAsset } from "$lib/splice/types"
import { join, sep } from "@tauri-apps/api/path"
import { exists, create, mkdir } from "@tauri-apps/plugin-fs"
import {
    getDescrambledSampleBytes,
    getDescrambledSampleURL,
} from "./store.svelte"
import { config, isSamplesDirValid } from "$lib/shared/config.svelte"
import {
    semitonesFor,
    transposeSuffix,
} from "$lib/shared/transpose.svelte"
import {
    decodeAudioFromArrayBuffer,
    decodeAudioFromURL,
} from "$lib/shared/wav"
import { renderAudioBufferToWav } from "$lib/shared/audio-render-worker-client"

export type DawStretchedSample = {
    path: string
    durationSeconds: number
}

type EncodeOptions = {
    shouldCancel?: () => boolean
    releaseSourceAfterRender?: boolean
    signal?: AbortSignal
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

function nextFrame() {
    return new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve())
    })
}

async function writeFileChunked(filePath: string, data: Uint8Array) {
    await ensureFileDirectoryExists(filePath)

    const file = await create(filePath)
    const chunkSize = 1024 * 1024

    try {
        for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
            await file.write(data.subarray(offset, offset + chunkSize))
            await nextFrame()
        }
    } finally {
        await file.close()
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

function estimatedRenderedDurationSeconds(
    sampleAsset: SampleAsset,
    tempoRatio: number
) {
    const metadataSeconds = sampleAsset.duration / 1000
    if (!Number.isFinite(metadataSeconds) || metadataSeconds <= 0) return 0
    if (!Number.isFinite(tempoRatio) || tempoRatio <= 0) return metadataSeconds
    return metadataSeconds / tempoRatio
}

async function encodeSampleWavWithDuration(
    sampleAsset: SampleAsset,
    semitones = semitonesFor(sampleAsset),
    tempoRatio = 1,
    trimToMetadataDuration = true,
    options: EncodeOptions = {}
): Promise<{ wavData: Uint8Array; durationSeconds: number }> {
    const throwIfCancelled = () => {
        if (options.shouldCancel?.() || options.signal?.aborted) {
            throw new DOMException("Sample render cancelled", "AbortError")
        }
    }

    throwIfCancelled()
    const decoded = options.releaseSourceAfterRender
        ? await (async () => {
              const bytes = await getDescrambledSampleBytes(
                  sampleAsset,
                  options.signal
              )
              const arrayBuffer = bytes.buffer.slice(
                  bytes.byteOffset,
                  bytes.byteOffset + bytes.byteLength
              )
              return await decodeAudioFromArrayBuffer(arrayBuffer, {
                  isolatedContext: true,
                  signal: options.signal,
              })
          })()
        : await decodeAudioFromURL(await getDescrambledSampleURL(sampleAsset), {
              signal: options.signal,
          })

    throwIfCancelled()
    const metadataDuration = (sampleAsset.duration / 1000) / tempoRatio
    const rendered = await renderAudioBufferToWav(decoded, {
        semitones,
        tempoRatio,
        trimStartSeconds: config.cut_mp3_delay ? 0.012 : 0,
        maxDurationSeconds: trimToMetadataDuration ? metadataDuration : null,
        signal: options.signal,
    })
    throwIfCancelled()

    console.info(
        "🎚️ Encoded sample duration",
        {
            name: sampleAsset.name,
            metadataSeconds: sampleAsset.duration / 1000,
            decodedSeconds: decoded.duration,
            renderedSeconds: rendered.durationSeconds,
            trimToMetadataDuration,
        }
    )

    return {
        wavData: rendered.wavData,
        durationSeconds: rendered.durationSeconds,
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
    trimToMetadataDuration = true,
    options: EncodeOptions = {}
): Promise<Uint8Array> {
    return (
        await encodeSampleWavWithDuration(
            sampleAsset,
            semitones,
            tempoRatio,
            trimToMetadataDuration,
            options
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

    await writeFileChunked(absolutePath, wavData)

    console.log("🎉 Success!")

    return absolutePath
}

export async function saveDawStretchedSampleInfo(
    sampleAsset: SampleAsset,
    dawBpm: number,
    options: EncodeOptions = {}
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
        if (options.shouldCancel?.()) {
            throw new DOMException("Sample render cancelled", "AbortError")
        }
        return {
            path: absolutePath,
            durationSeconds: estimatedRenderedDurationSeconds(
                sampleAsset,
                tempoRatio
            ),
        }
    }

    const { wavData, durationSeconds } = await encodeSampleWavWithDuration(
        sampleAsset,
        semitones,
        tempoRatio,
        false,
        {
            ...options,
            releaseSourceAfterRender: true,
        }
    )

    if (options.shouldCancel?.()) {
        throw new DOMException("Sample render cancelled", "AbortError")
    }

    console.log("🏆 DAW-stretched sample converted! Saving at", absolutePath)

    await writeFileChunked(absolutePath, wavData)

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
