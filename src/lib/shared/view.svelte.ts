import { refreshCollectionUrls } from "./collections.svelte"

export type ViewMode = "browse" | "collection"

export const viewStore = $state({
    mode: "browse" as ViewMode,
    collectionUuid: null as string | null,
})

/** Switch the main list to a collection, refreshing its (possibly expired) urls. */
export async function openCollection(uuid: string) {
    viewStore.mode = "collection"
    viewStore.collectionUuid = uuid
    await refreshCollectionUrls(uuid)
}

/** Return to the search/browse view. */
export function openBrowse() {
    viewStore.mode = "browse"
    viewStore.collectionUuid = null
}
