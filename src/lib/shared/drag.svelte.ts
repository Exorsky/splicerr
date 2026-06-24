import { startDrag } from "@crabnebula/tauri-plugin-drag"
import { join, appCacheDir } from "@tauri-apps/api/path"
import { exists, create, mkdir, readFile } from "@tauri-apps/plugin-fs"
import { saveDawStretchedSample, saveSample, savePackImage } from "./files.svelte"
import { semitonesFor } from "./transpose.svelte"
import { loading } from "./loading.svelte"
import type { SampleAsset, PackAsset } from "$lib/splice/types"

async function createDragIcon(
    packImagePath: string,
    packId: string
): Promise<string> {
    const cacheDir = await appCacheDir()
    const iconPath = await join(cacheDir, `${packId}.png`)

    if (!(await exists(iconPath))) {
        // Ensure cache directory exists
        if (!(await exists(cacheDir))) {
            await mkdir(cacheDir)
        }

        // Read the saved pack image file
        const imageData = await readFile(packImagePath)
        const buffer = new ArrayBuffer(imageData.byteLength)
        const view = new Uint8Array(buffer)
        view.set(imageData)
        const resizedImageData = await resizeImageToCorner(buffer)
        const file = await create(iconPath)
        await file.write(resizedImageData)
        await file.close()
    }

    return iconPath
}

async function createInvisibleIcon(): Promise<string> {
    const cacheDir = await appCacheDir()
    const iconPath = await join(cacheDir, "invisible-drag-icon.png")

    if (!(await exists(iconPath))) {
        if (!(await exists(cacheDir))) {
            await mkdir(cacheDir)
        }

        const transparentPng = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
            0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x02, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
            0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ])

        const file = await create(iconPath)
        await file.write(transparentPng)
        await file.close()
    }

    return iconPath
}

async function resizeImageToCorner(
    imageBuffer: ArrayBuffer
): Promise<Uint8Array> {
    return new Promise((resolve) => {
        const blob = new Blob([imageBuffer])
        const img = new Image()
        const iconSize = 64
        img.onload = () => {
            const canvasWidth = iconSize * 2
            const canvasHeight = iconSize * 2.5
            const canvas = document.createElement("canvas")
            const ctx = canvas.getContext("2d")!

            canvas.width = canvasWidth
            canvas.height = canvasHeight

            // Transparent background
            ctx.clearRect(0, 0, canvasWidth, canvasHeight)

            // Position the image in the top-right corner of the canvas
            const x = canvasWidth - iconSize
            const y = 0

            ctx.drawImage(img, x, y, iconSize, iconSize)

            canvas.toBlob((blob) => {
                blob!.arrayBuffer().then((buffer) => {
                    resolve(new Uint8Array(buffer))
                })
            }, "image/png")
        }
        img.src = URL.createObjectURL(blob)
    })
}

type DragData = { path: string; iconPath: string }

// Cache the on-disk WAV + drag icon per sample (keyed by uuid + transpose, since
// the saved path depends on the transpose suffix), so that the actual drag can be
// started synchronously.
const dragCache = new Map<string, DragData>()
const inFlight = new Map<string, Promise<DragData | null>>()

const cacheKey = (s: SampleAsset) => `${s.uuid}:${semitonesFor(s)}`
const dawCacheKey = (s: SampleAsset, bpm: number) =>
    `${cacheKey(s)}:daw-full:${Math.round(bpm)}`

async function dragIconForSample(sampleAsset: SampleAsset) {
    const pack = sampleAsset.parents.items[0] as PackAsset
    const packImagePath = await savePackImage(sampleAsset)
    if (packImagePath && (await exists(packImagePath))) {
        return await createDragIcon(packImagePath, pack.uuid)
    }
    return await createInvisibleIcon()
}

/**
 * Prepares a sample for dragging: descrambles + writes the WAV and builds the
 * drag icon, caching the result. Idempotent and deduplicated, and cheap once the
 * files already exist on disk. Call this ahead of the drag gesture (on hover /
 * pointerdown) so `handleSampleDrag` has everything ready synchronously.
 */
export function prefetchSampleDrag(sampleAsset: SampleAsset): Promise<DragData | null> {
    const key = cacheKey(sampleAsset)
    const cached = dragCache.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = inFlight.get(key)
    if (existing) return existing

    const p = (async () => {
        loading.samples.add(sampleAsset.uuid)
        loading.samplesCount++
        try {
            const path = await saveSample(sampleAsset)
            const iconPath = await dragIconForSample(sampleAsset)

            const data = { path, iconPath }
            dragCache.set(key, data)
            return data
        } catch (e) {
            console.error("⚠️ Failed preparing sample for drag", e)
            return null
        } finally {
            loading.samples.delete(sampleAsset.uuid)
            loading.samplesCount--
            inFlight.delete(key)
        }
    })()
    inFlight.set(key, p)
    return p
}

export function prefetchDawSampleDrag(
    sampleAsset: SampleAsset,
    dawBpm: number
): Promise<DragData | null> {
    const key = dawCacheKey(sampleAsset, dawBpm)
    const cached = dragCache.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = inFlight.get(key)
    if (existing) return existing

    const p = (async () => {
        loading.samples.add(sampleAsset.uuid)
        loading.samplesCount++
        try {
            const path = await saveDawStretchedSample(sampleAsset, dawBpm)
            const iconPath = await dragIconForSample(sampleAsset)
            const data = { path, iconPath }
            dragCache.set(key, data)
            return data
        } catch (e) {
            console.error("⚠️ Failed preparing DAW-stretched sample for drag", e)
            return null
        } finally {
            loading.samples.delete(sampleAsset.uuid)
            loading.samplesCount--
            inFlight.delete(key)
        }
    })()
    inFlight.set(key, p)
    return p
}

/**
 * dragstart handler. MUST stay synchronous: on macOS the native drag session
 * snapshots `NSApp.currentEvent`, so any `await` before `startDrag` leaves it
 * stale/nil and crashes AppKit (EXC_BAD_ACCESS in NSViewAlignRect). We therefore
 * only start the drag when the files are already prepared; otherwise we kick off
 * the prefetch so the next gesture works.
 */
export function handleSampleDrag(event: DragEvent, sampleAsset: SampleAsset) {
    event.preventDefault()
    const data = dragCache.get(cacheKey(sampleAsset))
    if (data) {
        startDrag({ item: [data.path], icon: data.iconPath })
    } else {
        console.log("🫳 Preparing", sampleAsset.name, "— drag again once ready")
        prefetchSampleDrag(sampleAsset)
    }
}

export function handleDawSampleDrag(
    event: DragEvent,
    sampleAsset: SampleAsset,
    dawBpm: number
) {
    event.preventDefault()
    const data = dragCache.get(dawCacheKey(sampleAsset, dawBpm))
    if (data) {
        startDrag({ item: [data.path], icon: data.iconPath })
    } else {
        console.log(
            "🫳 Preparing DAW-stretched sample",
            sampleAsset.name,
            "— drag again once ready"
        )
        prefetchDawSampleDrag(sampleAsset, dawBpm)
    }
}
