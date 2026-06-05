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
    import * as Tooltip from "$lib/components/ui/tooltip/index.js"
    import LoaderCircle from "lucide-svelte/icons/loader-circle"
    import { dataStore, fetchAssets } from "$lib/shared/store.svelte"
    import { cn, formatKey } from "$lib/utils"
    import { loading } from "$lib/shared/loading.svelte"
    import { assetIcons } from "$lib/shared/icons.svelte"
    import {handleSampleDrag, prefetchSampleDrag} from "$lib/shared/drag.svelte"

    let {
        class: className,
        selected,
        playing,
        sampleAsset,
    }: {
        class?: string
        selected: boolean
        playing: boolean
        sampleAsset: SampleAsset
    } = $props()

    let playButtonRef = $state<HTMLButtonElement>(null!)

    $effect(() => {
        if (selected) {
            playButtonRef.focus({ preventScroll: true })
        }
    })

    const pack = $derived(sampleAsset.parents.items[0])
    const name = $derived(sampleAsset.name.split("/").slice(-1))

    const millisToMinutesAndSeconds = (millis: number) => {
        var minutes = Math.floor(millis / 60000)
        var seconds = Math.floor((millis % 60000) / 1000)
        return minutes + ":" + (seconds < 10 ? "0" : "") + seconds
    }

    // Prepare the sample for dragging ahead of the gesture (debounced on hover,
    // and immediately on press) so the native drag can start synchronously —
    // doing the descramble/write inside dragstart crashes on macOS.
    let hoverTimer: ReturnType<typeof setTimeout> | null = null
    const startHoverPrefetch = () => {
        hoverTimer = setTimeout(() => prefetchSampleDrag(sampleAsset), 150)
    }
    const cancelHoverPrefetch = () => {
        if (hoverTimer) {
            clearTimeout(hoverTimer)
            hoverTimer = null
        }
    }
</script>

<button
    class={cn(
        "flex gap-4 items-center justify-between p-1 rounded-lg focus:outline-none cursor-grab",
        selected && "bg-muted",
        className
    )}
    id={`sample-list-entry-${sampleAsset.uuid}`}
    draggable="true"
    tabindex="-1"
    onpointerenter={startHoverPrefetch}
    onpointerleave={cancelHoverPrefetch}
    onmousedown={() => {
        globalAudio.selectSampleAsset(sampleAsset, false)
        prefetchSampleDrag(sampleAsset)
    }}
    ondragstart={(event) => handleSampleDrag(event, sampleAsset)}
>
    <PackPreview {pack} />
    <Button
        variant="ghost"
        bind:ref={playButtonRef}
        class="group flex-shrink-0 focus:outline-none"
        size="icon-lg"
        onclick={() =>
            playing
                ? globalAudio.ref.pause()
                : globalAudio.playSampleAsset(sampleAsset)}
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
                "text-left relative after:content-[''] after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-gradient-to-r after:from-transparent after:pointer-events-none",
                selected ? " after:to-muted" : "after:to-background"
            )}
        >
            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger
                        class="overflow-clip text-nowrap cursor-grab"
                    >
                        {name}
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        {name}
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>
            <div class="flex gap-0.5 text-xs overflow-clip text-nowrap">
                {#each sampleAsset.tags as tag}
                    {@const active = dataStore.tags.includes(tag.uuid)}
                    {@const tag_summary_tag = dataStore.tag_summary.find(
                        (t: any) => t.tag.uuid == tag.uuid
                    )}
                    <TagBadge
                        label={tag.label}
                        variant="ghost"
                        class="px-1 py-0.5 h-auto"
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
        progress={selected ? globalAudio.progress() : 0}
        onseek={(progress) => {
            const startTime = progress * (sampleAsset.duration / 1000)
            globalAudio.playSampleAsset(sampleAsset, startTime)
        }}
        class="min-w-32 w-[150px] h-12 flex-grow md:block hidden"
    />
    <div class="text-muted-foreground flex-shrink-0 w-14 flex-grow">
        {millisToMinutesAndSeconds(sampleAsset.duration)}
    </div>
    <div class="text-muted-foreground flex-shrink-0 w-14 flex-grow">
        {(sampleAsset.key &&
            formatKey(sampleAsset.key, sampleAsset.chord_type)) ??
            "--"}
    </div>
    <div class="text-muted-foreground flex-shrink-0 w-14 flex-grow">
        {sampleAsset.bpm ?? "--"}
    </div>
</button>
