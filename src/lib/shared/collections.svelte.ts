import {
    exists,
    BaseDirectory,
    readTextFile,
    create,
    writeTextFile,
    mkdir,
} from "@tauri-apps/plugin-fs"
import { appConfigDir } from "@tauri-apps/api/path"
import type {
    AssetFilesByUuidsResponse,
    SampleAsset,
} from "$lib/splice/types"
import { AssetFilesByUuids, querySplice } from "$lib/splice/api"

const COLLECTIONS_FILE_NAME = "collections.json"

// Reserved uuid for the built-in "Likes" collection. It always exists and
// can't be renamed or deleted; the per-row heart toggles membership in it.
export const LIKES_UUID = "likes"

export type Collection = {
    uuid: string
    name: string
    created_at: number
    // Sample order is tracked separately so we keep insertion order explicitly.
    sample_uuids: string[]
    // Cached metadata for each sample, keyed by uuid. The `files[].url`s inside
    // are Splice signed CDN links that expire, so they are refreshed on demand
    // (see refreshCollectionUrls in store/api wiring) rather than trusted long-term.
    samples: Record<string, SampleAsset>
}

export const collectionsStore = $state({
    collections: [] as Collection[],
    loaded: false,
})

// Shared state for the "New collection" modal. When pendingSample is set, the
// sample is added to the collection right after it's created.
export const newCollectionDialog = $state({
    open: false,
    pendingSample: null as SampleAsset | null,
})

export function openNewCollectionDialog(sample: SampleAsset | null = null) {
    newCollectionDialog.pendingSample = sample
    newCollectionDialog.open = true
}

export const findCollection = (uuid: string) =>
    collectionsStore.collections.find((c) => c.uuid == uuid)

export const isSampleInCollection = (colUuid: string, sampleUuid: string) =>
    findCollection(colUuid)?.sample_uuids.includes(sampleUuid) ?? false

/** The built-in Likes collection (always present after load). */
export const likesCollection = () => findCollection(LIKES_UUID)

/** User-created collections, excluding the built-in Likes collection. */
export const userCollections = () =>
    collectionsStore.collections.filter((c) => c.uuid != LIKES_UUID)

export const isLiked = (sampleUuid: string) =>
    isSampleInCollection(LIKES_UUID, sampleUuid)

export function toggleLike(asset: SampleAsset) {
    if (isLiked(asset.uuid)) {
        removeSample(LIKES_UUID, asset.uuid)
    } else {
        addSample(LIKES_UUID, asset)
    }
}

/** Creates the built-in Likes collection if it doesn't exist yet. */
function ensureLikesCollection() {
    if (findCollection(LIKES_UUID)) return
    collectionsStore.collections.unshift({
        uuid: LIKES_UUID,
        name: "Likes",
        created_at: Date.now(),
        sample_uuids: [],
        samples: {},
    })
}

export async function loadCollections() {
    if (
        !(await exists(COLLECTIONS_FILE_NAME, {
            baseDir: BaseDirectory.AppConfig,
        }))
    ) {
        console.log("📂 Collections file not found, starting empty")
    } else {
        try {
            const fileContent = await readTextFile(COLLECTIONS_FILE_NAME, {
                baseDir: BaseDirectory.AppConfig,
            })
            const parsed = JSON.parse(fileContent)
            if (Array.isArray(parsed?.collections)) {
                collectionsStore.collections = parsed.collections
            }
            console.log("📂 Collections loaded")
        } catch (error) {
            console.error("⚠️ Failed to parse collections, starting empty", error)
        }
    }
    ensureLikesCollection()
    collectionsStore.loaded = true
}

export async function saveCollections() {
    const appConfig = await appConfigDir()
    if (!(await exists(appConfig))) await mkdir(appConfig)

    if (
        !(await exists(COLLECTIONS_FILE_NAME, {
            baseDir: BaseDirectory.AppConfig,
        }))
    ) {
        await create(COLLECTIONS_FILE_NAME, {
            baseDir: BaseDirectory.AppConfig,
        })
    }

    await writeTextFile(
        COLLECTIONS_FILE_NAME,
        JSON.stringify({ collections: collectionsStore.collections }),
        { baseDir: BaseDirectory.AppConfig }
    )
    console.log("💾 Collections saved")
}

export function createCollection(name: string): Collection {
    const collection: Collection = {
        uuid: crypto.randomUUID(),
        name: name.trim() || "Untitled",
        created_at: Date.now(),
        sample_uuids: [],
        samples: {},
    }
    collectionsStore.collections.push(collection)
    saveCollections()
    return collection
}

export function renameCollection(uuid: string, name: string) {
    if (uuid == LIKES_UUID) return
    const collection = findCollection(uuid)
    if (!collection) return
    collection.name = name.trim() || collection.name
    saveCollections()
}

export function deleteCollection(uuid: string) {
    if (uuid == LIKES_UUID) return
    const index = collectionsStore.collections.findIndex((c) => c.uuid == uuid)
    if (index == -1) return
    collectionsStore.collections.splice(index, 1)
    saveCollections()
}

export function addSample(colUuid: string, asset: SampleAsset) {
    const collection = findCollection(colUuid)
    if (!collection) return
    // Idempotent: adding an existing sample just refreshes its cached metadata.
    if (!collection.sample_uuids.includes(asset.uuid)) {
        collection.sample_uuids.push(asset.uuid)
    }
    collection.samples[asset.uuid] = $state.snapshot(asset) as SampleAsset
    saveCollections()
}

export function removeSample(colUuid: string, sampleUuid: string) {
    const collection = findCollection(colUuid)
    if (!collection) return
    const index = collection.sample_uuids.indexOf(sampleUuid)
    if (index != -1) collection.sample_uuids.splice(index, 1)
    delete collection.samples[sampleUuid]
    saveCollections()
}

/**
 * Re-resolves the signed CDN urls for every sample in a collection. The
 * `files[].url`s cached in collections.json expire, so before playing/dragging
 * from a collection we fetch fresh files by uuid and merge the new urls into
 * the cached files, matching by stable file uuid (the array order — audio at
 * files[0], waveform at files[1] — must be preserved for playback/waveform).
 */
export async function refreshCollectionUrls(colUuid: string) {
    const collection = findCollection(colUuid)
    if (!collection || collection.sample_uuids.length == 0) return

    const response = (await querySplice(AssetFilesByUuids, {
        assetUuids: [...collection.sample_uuids],
    })) as AssetFilesByUuidsResponse | null

    const lists = response?.data?.assetFiles
    if (!lists) {
        console.warn("⚠️ Could not refresh collection urls")
        return
    }

    let refreshed = false
    for (const list of lists) {
        const sample = collection.samples[list.assetUuid]
        if (!sample) continue
        for (const freshFile of list.files ?? []) {
            const existing = sample.files.find((f) => f.uuid == freshFile.uuid)
            if (existing && freshFile.url) {
                existing.url = freshFile.url
                refreshed = true
            }
        }
    }

    if (refreshed) {
        saveCollections()
        console.info("🔗 Refreshed collection sample urls")
    }
}

/** Samples of a collection in their stored order. */
export function collectionSamples(colUuid: string): SampleAsset[] {
    const collection = findCollection(colUuid)
    if (!collection) return []
    return collection.sample_uuids
        .map((uuid) => collection.samples[uuid])
        .filter((s): s is SampleAsset => !!s)
}
