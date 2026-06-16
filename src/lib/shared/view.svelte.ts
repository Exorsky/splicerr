import { refreshCollectionUrls } from "./collections.svelte"

export type ViewMode = "browse" | "collection"

export const viewStore = $state({
    mode: "browse" as ViewMode,
    collectionUuid: null as string | null,
    // Tag uuids used to filter the currently open collection (client-side).
    tagFilter: [] as string[],
})

/** Switch the main list to a collection, refreshing its (possibly expired) urls. */
export async function openCollection(uuid: string) {
    viewStore.mode = "collection"
    viewStore.collectionUuid = uuid
    viewStore.tagFilter = []
    await refreshCollectionUrls(uuid)
}

/** Return to the search/browse view. */
export function openBrowse() {
    viewStore.mode = "browse"
    viewStore.collectionUuid = null
    viewStore.tagFilter = []
}

/** Toggle a tag in the active collection's filter. */
export function toggleCollectionTag(tagUuid: string) {
    const index = viewStore.tagFilter.indexOf(tagUuid)
    if (index == -1) viewStore.tagFilter.push(tagUuid)
    else viewStore.tagFilter.splice(index, 1)
}
