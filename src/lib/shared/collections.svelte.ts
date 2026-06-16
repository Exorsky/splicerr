import {
    exists,
    BaseDirectory,
    readTextFile,
    create,
    writeTextFile,
    mkdir,
} from "@tauri-apps/plugin-fs"
import { appConfigDir } from "@tauri-apps/api/path"
import type { SampleAsset } from "$lib/splice/types"

const COLLECTIONS_FILE_NAME = "collections.json"

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

export const findCollection = (uuid: string) =>
    collectionsStore.collections.find((c) => c.uuid == uuid)

export const isSampleInCollection = (colUuid: string, sampleUuid: string) =>
    findCollection(colUuid)?.sample_uuids.includes(sampleUuid) ?? false

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
    const collection = findCollection(uuid)
    if (!collection) return
    collection.name = name.trim() || collection.name
    saveCollections()
}

export function deleteCollection(uuid: string) {
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

/** Samples of a collection in their stored order. */
export function collectionSamples(colUuid: string): SampleAsset[] {
    const collection = findCollection(colUuid)
    if (!collection) return []
    return collection.sample_uuids
        .map((uuid) => collection.samples[uuid])
        .filter((s): s is SampleAsset => !!s)
}
