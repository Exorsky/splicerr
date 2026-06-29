import { querySplice, SamplesSearch } from "$lib/splice/api"
import { refreshSampleUrl } from "./collections.svelte"
import { descrambleSample } from "$lib/splice/descrambler"
import type {
    AssetCategorySlug,
    AssetSortType,
    ChordType,
    Key,
    SampleAsset,
    SamplesSearchResponse,
    SortOrder,
    TagSummaryEntry,
} from "$lib/splice/types"
import { globalAudio } from "./audio.svelte"
import { loading } from "./loading.svelte"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { semitonesFor } from "./transpose.svelte"
import { decodeAudioFromURL } from "./wav"
import { renderAudioBufferToWav } from "$lib/shared/audio-render-worker-client"

export const DEFAULT_SORT = "relevance"
export const PER_PAGE = 50
const MAX_DESCRAMBLED_BLOBS = 4
const MAX_TRANSPOSED_BLOBS = 2

export const randomSeed = () =>
    Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString()

export const dataStore = $state({
    sampleAssets: [] as SampleAsset[],
    descrambledSamples: new Map<string, string>(),
    // Pitch-shifted preview blobs, keyed by `${uuid}:${semitones}`
    transposedSamples: new Map<string, string>(),
    tags: [] as string[],
    tag_summary: [] as TagSummaryEntry[],
    total_records: 0,
})

export const keys = [
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
export const chord_types = ["major", "minor"]

export const queryStore = $state({
    query: "",
    sort: DEFAULT_SORT as AssetSortType,
    random_seed: randomSeed(),
    order: "DESC" as SortOrder,
    page: 1,
    parent_asset_uuid: null as string | null,
    parent_asset_name: null as string | null,
    asset_category_slug: null as AssetCategorySlug | null,
    bpm: null as string | null,
    min_bpm: null as number | null,
    max_bpm: null as number | null,
    key: null as Key | null,
    chord_type: null as ChordType | null,
})

// The query identity is the part of the query that uniquely identifies the returned data
// It is used to determine if the fetched data should replace the current data, be appended to it, or be ignored
const queryIdentity = $derived({
    query: queryStore.query,
    sort: queryStore.sort,
    order: queryStore.order,
    random_seed: queryStore.random_seed,
    parent_asset_uuid: queryStore.parent_asset_uuid,
    tags: dataStore.tags,
    asset_category_slug: queryStore.asset_category_slug,
    bpm: queryStore.bpm?.toString(),
    min_bpm: queryStore.min_bpm,
    max_bpm: queryStore.max_bpm,
    key: queryStore.key,
    chord_type: queryStore.chord_type,
})

export const storeCallbacks = $state({
    onbeforedataupdate: null as (() => void) | null,
    onbeforetagsupdate: null as (() => void) | null,
})

let currentQueryIdentity: string = ""

export function openPackSamples(pack: { uuid?: string; name?: string } | null) {
    const packName = pack?.name?.split("/").slice(-1)[0] ?? null
    queryStore.page = 1
    queryStore.query = pack?.uuid ? "" : packName?.split(/\s+/)[0] ?? ""
    queryStore.parent_asset_uuid = pack?.uuid ?? null
    queryStore.parent_asset_name = packName
    queryStore.sort = pack?.uuid ? "name" : DEFAULT_SORT
    queryStore.order = "ASC"
    queryStore.random_seed = randomSeed()
    dataStore.tags = []
    queryStore.asset_category_slug = null
    queryStore.bpm = null
    queryStore.min_bpm = null
    queryStore.max_bpm = null
    queryStore.key = null
    queryStore.chord_type = null
    fetchAssets()
}

export function closePackSamples() {
    queryStore.page = 1
    queryStore.parent_asset_uuid = null
    queryStore.parent_asset_name = null
    queryStore.query = ""
    queryStore.sort = DEFAULT_SORT
    queryStore.order = "DESC"
    queryStore.random_seed = randomSeed()
    dataStore.tags = []
    queryStore.asset_category_slug = null
    queryStore.bpm = null
    queryStore.min_bpm = null
    queryStore.max_bpm = null
    queryStore.key = null
    queryStore.chord_type = null
    fetchAssets()
}

async function fetchBinaryResponse(url: string, signal?: AbortSignal) {
    try {
        return await window.fetch(url, { signal })
    } catch (err) {
        if (signal?.aborted) throw err
        console.info("🌐 Browser fetch failed, falling back to Tauri HTTP", err)
        return await tauriFetch(url, { signal })
    }
}

function touchMapEntry<T>(map: Map<string, T>, key: string) {
    const value = map.get(key)
    if (value === undefined) return value

    map.delete(key)
    map.set(key, value)
    return value
}

function trimDescrambledCache() {
    for (const [uuid, blobURL] of dataStore.descrambledSamples) {
        if (dataStore.descrambledSamples.size <= MAX_DESCRAMBLED_BLOBS) break
        if (uuid === globalAudio.currentAsset?.uuid) continue

        dataStore.descrambledSamples.delete(uuid)
        window.URL.revokeObjectURL(blobURL)
        console.info("🧹 Trimmed descrambled sample blob")
    }
}

function trimTransposedCache() {
    for (const [key, blobURL] of dataStore.transposedSamples) {
        if (dataStore.transposedSamples.size <= MAX_TRANSPOSED_BLOBS) break
        if (key.startsWith(`${globalAudio.currentAsset?.uuid}:`)) continue

        dataStore.transposedSamples.delete(key)
        window.URL.revokeObjectURL(blobURL)
        console.info("🧹 Trimmed transposed sample blob")
    }
}

export const fetchAssets = () => {
    const identityBeforeFetch = JSON.stringify(queryIdentity)
    if (identityBeforeFetch != currentQueryIdentity) {
        storeCallbacks.onbeforedataupdate?.()
    }
    loading.assets = true
    querySplice(SamplesSearch, {
        ...queryIdentity,
        parent_asset_type: queryStore.parent_asset_uuid ? "pack" : null,
        page: queryStore.page,
        limit: PER_PAGE,
    })
        .then((response) => {
            const searchResult = (response as SamplesSearchResponse).data
                .assetsSearch
            const identityAfterFetch = JSON.stringify(queryIdentity)
            if (identityBeforeFetch == identityAfterFetch) {
                if (identityBeforeFetch == currentQueryIdentity) {
                    dataStore.sampleAssets.push(...searchResult.items)
                    console.info("➕ Loaded more assets")
                } else {
                    // Free descrambled samples that are not in the new search result / currently selected
                    for (const sampleAsset of dataStore.sampleAssets) {
                        if (
                            !searchResult.items.some(
                                (other) => sampleAsset.uuid == other.uuid
                            ) &&
                            sampleAsset.uuid != globalAudio.currentAsset?.uuid
                        ) {
                            freeDescrambledSample(sampleAsset.uuid)
                        }
                    }
                    // Prevent duplicates
                    dataStore.sampleAssets = searchResult.items.filter(
                        (asset) =>
                            !dataStore.sampleAssets.some(
                                (other) => other.uuid == asset.uuid
                            )
                    )
                    currentQueryIdentity = identityAfterFetch
                    queryStore.page = 1
                    console.info("🔄️ Loaded new assets")
                }
                dataStore.total_records = searchResult.response_metadata.records

                storeCallbacks.onbeforetagsupdate?.()
                dataStore.tag_summary = searchResult.tag_summary

                loading.assets = false
                loading.beforeFirstLoad = false

                loading.fetchError = null
            } else {
                console.info("🕜 Ignored stale assets")
            }
        })
        .catch((error: Error) => {
            console.error("⚠️ Failed to fetch assets", error)
            loading.fetchError = error
            loading.assets = false
        })
}

export async function getDescrambledSampleURL(sampleAsset: SampleAsset) {
    const existingBlobURL = touchMapEntry(
        dataStore.descrambledSamples,
        sampleAsset.uuid
    )
    if (existingBlobURL) {
        console.info("✔️ Reusing descrambled sample blob")
        return existingBlobURL
    }

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    // A failing fetch/descramble must still clear the loading flag, otherwise the
    // sample stays stuck "loading" forever (endless spinner) and every later play
    // bails out early. This bites samples in a collection whose cached CDN url has
    // expired and couldn't be refreshed (see refreshCollectionUrls).
    try {
        let response = await fetchBinaryResponse(sampleAsset.files[0].url)
        if (!response.ok) {
            // The presigned url likely expired mid-session. Re-resolve it from the
            // parent pack and retry once before giving up.
            const refreshed = await refreshSampleUrl(sampleAsset)
            if (refreshed) {
                response = await fetchBinaryResponse(sampleAsset.files[0].url)
            }
        }
        if (!response.ok) {
            throw new Error(
                `Sample fetch failed (${response.status} ${response.statusText}) — the CDN url is likely expired`
            )
        }

        const data = new Uint8Array(await response.arrayBuffer())

        const descrambledData = descrambleSample(data)

        const blob = new Blob([descrambledData], {
            type: "audio/mp3",
        })

        const blobURL = window.URL.createObjectURL(blob)

        dataStore.descrambledSamples.set(sampleAsset.uuid, blobURL)
        trimDescrambledCache()

        console.info("🔗 Created descrambled sample blob")

        return blobURL
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

export async function getDescrambledSampleBytes(
    sampleAsset: SampleAsset,
    signal?: AbortSignal
) {
    const throwIfAborted = () => {
        if (signal?.aborted) {
            throw new DOMException("Sample fetch cancelled", "AbortError")
        }
    }

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    try {
        throwIfAborted()
        let response = await fetchBinaryResponse(sampleAsset.files[0].url, signal)
        if (!response.ok) {
            const refreshed = await refreshSampleUrl(sampleAsset)
            if (refreshed) {
                throwIfAborted()
                response = await fetchBinaryResponse(
                    sampleAsset.files[0].url,
                    signal
                )
            }
        }
        if (!response.ok) {
            throw new Error(
                `Sample fetch failed (${response.status} ${response.statusText}) — the CDN url is likely expired`
            )
        }

        throwIfAborted()
        const data = new Uint8Array(await response.arrayBuffer())
        throwIfAborted()
        return descrambleSample(data)
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

export function freeDescrambledSample(uuid: string) {
    // Free any pitch-shifted variants of this sample first
    for (const key of [...dataStore.transposedSamples.keys()]) {
        if (key.startsWith(`${uuid}:`)) {
            window.URL.revokeObjectURL(dataStore.transposedSamples.get(key)!)
            dataStore.transposedSamples.delete(key)
        }
    }

    const existingBlobURL = dataStore.descrambledSamples.get(uuid)
    if (!existingBlobURL) return false

    dataStore.descrambledSamples.delete(uuid)
    window.URL.revokeObjectURL(existingBlobURL)
    console.info("⛓️‍💥 Freed descrambled sample")

    return true
}

/**
 * Returns a blob URL of the sample pitch-shifted by `semitones`,
 * rendering and caching it on first use.
 */
export async function getTransposedSampleURL(
    sampleAsset: SampleAsset,
    semitones: number
) {
    const cacheKey = `${sampleAsset.uuid}:${semitones}`
    const existing = touchMapEntry(dataStore.transposedSamples, cacheKey)
    if (existing) {
        console.info("✔️ Reusing transposed sample blob")
        return existing
    }

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    try {
        const descrambledURL = await getDescrambledSampleURL(sampleAsset)
        const buffer = await decodeAudioFromURL(descrambledURL)
        const { wavData } = await renderAudioBufferToWav(buffer, {
            semitones,
            tempoRatio: 1,
            trimStartSeconds: 0,
            maxDurationSeconds: null,
        })
        const blobURL = window.URL.createObjectURL(
            new Blob([wavData], { type: "audio/wav" })
        )
        dataStore.transposedSamples.set(cacheKey, blobURL)
        trimTransposedCache()
        console.info(`🎚️ Created transposed sample blob (${semitones} st)`)
        return blobURL
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

/** Picks the right playback URL for a sample given the current transpose settings. */
export async function getPlaybackSampleURL(sampleAsset: SampleAsset) {
    const semitones = semitonesFor(sampleAsset)
    if (!semitones) return await getDescrambledSampleURL(sampleAsset)
    return await getTransposedSampleURL(sampleAsset, semitones)
}

/** Drops every cached pitch-shifted blob (e.g. after transpose settings change). */
export function clearTransposedCache() {
    for (const url of dataStore.transposedSamples.values()) {
        window.URL.revokeObjectURL(url)
    }
    dataStore.transposedSamples.clear()
    console.info("🧹 Cleared transposed sample cache")
}
