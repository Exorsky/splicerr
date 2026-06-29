<script lang="ts">
    import { globalAudio } from "$lib/shared/audio.svelte"
    import PackPreview from "$lib/components/pack-preview.svelte"
    import TagBadge from "$lib/components/tag-badge.svelte"
    import Waveform from "$lib/components/waveform.svelte"
    import type { SampleAsset } from "$lib/splice/types"
    import CircleX from "lucide-svelte/icons/circle-x"
    import Pause from "lucide-svelte/icons/pause"
    import Play from "lucide-svelte/icons/play"
    import Button from "$lib/components/ui/button/button.svelte"
    import { buttonVariants } from "$lib/components/ui/button/index.js"
    import * as Tooltip from "$lib/components/ui/tooltip/index.js"
    import LoaderCircle from "lucide-svelte/icons/loader-circle"
    import { dataStore, fetchAssets } from "$lib/shared/store.svelte"
    import { cn, formatKey } from "$lib/utils"
    import { loading } from "$lib/shared/loading.svelte"
    import { assetIcons } from "$lib/shared/icons.svelte"
    import { handleSampleDrag, prefetchSampleDrag } from "$lib/shared/drag.svelte"
    import {
        dawSync,
        setDawSyncedPlaybackEnabled,
        toggleDawSyncedPlayback,
    } from "$lib/shared/daw-sync.svelte"
    import * as Popover from "$lib/components/ui/popover"
    import Plus from "lucide-svelte/icons/plus"
    import Check from "lucide-svelte/icons/check"
    import Heart from "lucide-svelte/icons/heart"
    import Ellipsis from "lucide-svelte/icons/ellipsis"
    import ChevronLeft from "lucide-svelte/icons/chevron-left"
    import ListPlus from "lucide-svelte/icons/list-plus"
    import Trash2 from "lucide-svelte/icons/trash-2"
    import {
        addSample,
        removeSample,
        isSampleInCollection,
        userCollections,
        toggleLike,
        isLiked,
        openNewCollectionDialog,
        LIKES_UUID,
    } from "$lib/shared/collections.svelte"

    let {
        class: className,
        selected,
        playing,
        sampleAsset,
        collectionUuid = null,
        onopenpack,
        onremove,
    }: {
        class?: string
        selected: boolean
        playing: boolean
        sampleAsset: SampleAsset
        // When set, this row is rendered inside a collection view.
        collectionUuid?: string | null
        onopenpack?: (pack: SampleAsset["parents"]["items"][number]) => void
        onremove?: () => void
    } = $props()

    let menuOpen = $state(false)
    const liked = $derived(isLiked(sampleAsset.uuid))
    // Which view the three-dots popover shows: the root menu or the picker.
    let menuView = $state<"root" | "collections">("root")

    const toggleInCollection = (colUuid: string) => {
        if (isSampleInCollection(colUuid, sampleAsset.uuid)) {
            removeSample(colUuid, sampleAsset.uuid)
        } else {
            addSample(colUuid, sampleAsset)
        }
    }

    let playButtonRef = $state<HTMLButtonElement>(null!)

    $effect(() => {
        if (selected) {
            playButtonRef.focus({ preventScroll: true })
        }
    })

    const pack = $derived(sampleAsset.parents.items[0])
    const name = $derived(sampleAsset.name.split("/").slice(-1))
    const waveformProgress = $derived.by(() => {
        if (!selected) return 0

        if (dawSync.connected) {
            const progress =
                dawSync.visualDuration > 0
                    ? dawSync.visualCurrentTime / dawSync.visualDuration
                    : 0
            return Math.min(1, Math.max(0, progress))
        }

        return globalAudio.progress() || 0
    })

    const millisToMinutesAndSeconds = (millis: number) => {
        var minutes = Math.floor(millis / 60000)
        var seconds = Math.floor((millis % 60000) / 1000)
        return minutes + ":" + (seconds < 10 ? "0" : "") + seconds
    }

    // Prepare the sample for dragging on press (not hover) so the native drag can
    // start synchronously — doing the descramble/write inside dragstart crashes on
    // macOS.
</script>

<button
    class={cn(
        "glass-row flex gap-4 items-center justify-between p-2 rounded-2xl focus:outline-none cursor-grab",
        selected && "glass-row-selected",
        className
    )}
    id={`sample-list-entry-${sampleAsset.uuid}`}
    draggable="true"
    tabindex="-1"
    onmousedown={() => {
        globalAudio.selectSampleAsset(sampleAsset, false)
        if (!dawSync.connected) {
            prefetchSampleDrag(sampleAsset)
        }
    }}
    ondragstart={(event) => handleSampleDrag(event, sampleAsset)}
>
    <PackPreview {pack} size={11} {onopenpack} />
    <Button
        variant="ghost"
        bind:ref={playButtonRef}
        class="group flex-shrink-0 focus:outline-none rounded-full bg-white/[0.06] hover:bg-white/[0.14]"
        size="icon-lg"
        onmousedown={(event) => event.stopPropagation()}
        onclick={() => {
            if (dawSync.connected) {
                if (selected) {
                    toggleDawSyncedPlayback()
                } else {
                    globalAudio.selectSampleAsset(sampleAsset, false)
                    setDawSyncedPlaybackEnabled(true)
                }
                return
            }

            playing
                ? globalAudio.ref.pause()
                : globalAudio.playSampleAsset(sampleAsset)
        }}
    >
        {#if (selected && globalAudio.loading) || (loading.samplesCount && loading.samples.has(sampleAsset.uuid))}
            <LoaderCircle class="animate-spin" />
        {:else if playing}
            <Pause />
        {:else}
            <Play class="group-hover:block hidden" />
            {#if sampleAsset.asset_category_slug in assetIcons}
                {@const Icon = assetIcons[sampleAsset.asset_category_slug]}
                <Icon class="group-hover:hidden" />
            {:else}
                <CircleX class="group-hover:hidden" />
            {/if}
        {/if}
    </Button>
    <div class="min-w-32 w-96 flex-[3_1_auto] overflow-clip">
        <div
            class={cn(
                "text-left relative after:content-[''] after:absolute after:inset-y-0 after:right-0 after:w-6 after:bg-gradient-to-r after:from-transparent after:to-background/0 after:pointer-events-none"
            )}
        >
            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger
                        class="overflow-clip text-nowrap cursor-grab text-[15px] font-medium text-foreground"
                    >
                        {name}
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        {name}
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>
            <div class="flex gap-1 text-xs overflow-clip text-nowrap pt-1">
                {#each sampleAsset.tags as tag}
                    {@const active = dataStore.tags.includes(tag.uuid)}
                    {@const tag_summary_tag = dataStore.tag_summary.find(
                        (t: any) => t.tag.uuid == tag.uuid
                    )}
                    <TagBadge
                        label={tag.label}
                        variant="ghost"
                        class="h-6 px-2 py-0 text-[11px]"
                        count={tag_summary_tag?.count ?? 0}
                        onclick={() => {
                            if (!active) {
                                dataStore.tags.push(tag.uuid)
                                // updateTagSummary()
                                fetchAssets()
                            }
                        }}
                    />
                {/each}
            </div>
        </div>
    </div>
    <Waveform
        src={sampleAsset.files[1].url}
        progress={waveformProgress}
        onseek={(progress) => {
            if (dawSync.connected) {
                globalAudio.selectSampleAsset(sampleAsset, false)
                return
            }

            const startTime = progress * (sampleAsset.duration / 1000)
            globalAudio.playSampleAsset(sampleAsset, startTime)
        }}
        class="min-w-40 w-[220px] h-14 flex-grow md:block hidden"
    />
    <div class="text-muted-foreground text-sm tabular-nums flex-shrink-0 w-14 flex-grow">
        {millisToMinutesAndSeconds(sampleAsset.duration)}
    </div>
    <div class="text-muted-foreground text-sm flex-shrink-0 w-14 flex-grow">
        {(sampleAsset.key &&
            formatKey(sampleAsset.key, sampleAsset.chord_type)) ??
            "--"}
    </div>
    <div class="text-muted-foreground text-sm tabular-nums flex-shrink-0 w-14 flex-grow">
        {sampleAsset.bpm ?? "--"}
    </div>
    <!-- svelte-ignore node_invalid_placement_ssr -->
    <span
        class="flex-shrink-0 flex items-center gap-0.5"
        onmousedown={(e) => e.stopPropagation()}
        ondragstart={(e) => e.preventDefault()}
        role="presentation"
    >
        <Button
            variant="ghost"
            size="icon"
            class={cn("size-8", liked ? "text-foreground" : "text-muted-foreground")}
            title={liked ? "Remove like" : "Like"}
            onclick={() => toggleLike(sampleAsset)}
        >
            <Heart size="16" fill={liked ? "currentColor" : "none"} />
        </Button>

        <Popover.Root
            bind:open={menuOpen}
            onOpenChange={(open) => {
                if (open) menuView = "root"
            }}
        >
            <Popover.Trigger
                class={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "size-8 text-muted-foreground"
                )}
                title="More"
            >
                <Ellipsis size="16" />
            </Popover.Trigger>
            <Popover.Content class="w-56 p-1" align="end" side="left">
                {#if menuView === "root"}
                    <button
                        class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted text-left"
                        onclick={() => (menuView = "collections")}
                    >
                        <ListPlus size="16" /> Add to collection
                    </button>
                    {#if collectionUuid && collectionUuid !== LIKES_UUID}
                        <button
                            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-muted text-left"
                            onclick={() => {
                                onremove?.()
                                menuOpen = false
                            }}
                        >
                            <Trash2 size="16" /> Remove from collection
                        </button>
                    {/if}
                {:else}
                    <button
                        class="flex w-full items-center gap-1 rounded-sm px-1 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground text-left"
                        onclick={() => (menuView = "root")}
                    >
                        <ChevronLeft size="14" /> Add to collection
                    </button>
                    <div class="flex flex-col max-h-56 overflow-y-auto">
                        {#each userCollections() as collection (collection.uuid)}
                            {@const inIt = isSampleInCollection(
                                collection.uuid,
                                sampleAsset.uuid
                            )}
                            <button
                                class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted text-left"
                                onclick={() =>
                                    toggleInCollection(collection.uuid)}
                            >
                                <span
                                    class="flex-shrink-0 size-4 flex items-center justify-center"
                                >
                                    {#if inIt}
                                        <Check size="14" />
                                    {/if}
                                </span>
                                <span class="truncate flex-grow">
                                    {collection.name}
                                </span>
                            </button>
                        {/each}
                    </div>
                    <div class="border-t border-border mt-1 pt-1">
                        <button
                            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted text-left"
                            onclick={() => {
                                menuOpen = false
                                openNewCollectionDialog(sampleAsset)
                            }}
                        >
                            <Plus size="16" /> New collection
                        </button>
                    </div>
                {/if}
            </Popover.Content>
        </Popover.Root>
    </span>
</button>
