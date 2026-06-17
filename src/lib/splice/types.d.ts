export type SamplesSearchResponse = {
    data: {
        assetsSearch: {
            items: Array<SampleAsset>
            __typename: string
            tag_summary: Array<TagSummaryEntry>
            pagination_metadata: {
                currentPage: number
                totalPages: number
                __typename: string
            }
            response_metadata: {
                records: number
                __typename: string
            }
        }
    }
}

export type AssetPrice = {
    amount: number
    currency: string
    __typename: string
}

export type AssetTag = {
    uuid: string
    label: string
    __typename: string
}

export type TagSummaryEntry = {
    count: number
    tag: {
        uuid: string
        label: string
        taxonomy: {
            uuid: string
            name: string
            __typename: string
        }
        __typename: string
    }
    __typename: string
}

export type AssetFile = {
    uuid: string
    name?: string
    hash?: string
    path: string
    asset_file_type_slug: string
    url: string
    __typename: string
}

export type SampleAsset = {
    asset_type_slug: AssetTypeSlug
    asset_prices: Array<AssetPrice>
    uuid: string
    name: string
    tags: Array<AssetTag>
    files: Array<AssetFile>
    __typename: string
    parents: {
        items: Array<PackAsset>
        __typename: string
    }
    bpm?: number
    chord_type?: string
    key?: string
    duration: number
    asset_category_slug: AssetCategorySlug
}

export type PackAsset = {
    permalink_slug: string
    permalink_base_url: string
    uuid: string
    name: string
    files: Array<AssetFile>
    __typename: string
}

export type SoundsSearchAutocompleteResponse = {
    data: {
        soundsSearchSuggestions: {
            autocompleteUuid: string
            results: Array<AutocompleteSuggestion>
            __typename: string
        }
    }
}

export type AutocompleteSuggestion = {
    autocompleteTerm: string
    termType: string
    length: number
    offset: number
    __typename: string
}

export type AssetFilesByUuidsResponse = {
    data: {
        assetFiles: Array<{
            assetUuid: string
            files: Array<AssetFile>
            __typename: string
        }>
    }
}

export type SortOrder = "ASC" | "DESC"

export type AssetSortType =
    | "popularity"
    | "random"
    | "relevance"
    | "recency"
    | "bpm"
    | "duration"
    | "key"
    | "name"

export type AssetTypeSlug = "sample" | "preset" | "pack"

export type AssetCategorySlug = "loop" | "oneshot"

export type Key = (typeof keys)[number]

export type ChordType = (typeof chordTypes)[number]