<script lang="ts">
    import * as HoverCard from "$lib/components/ui/hover-card/index.js"
    import type { PackAsset } from "$lib/splice/types"
    import { openUrl } from "@tauri-apps/plugin-opener"
    import { cn } from "$lib/utils"
    const {
        pack,
        side = "right",
        size = 12,
        class: className,
    }: {
        pack: PackAsset | undefined
        side?: "right" | "top" | "bottom" | "left"
        size?: number
        class?: string
    } = $props()

    const name = $derived(pack?.name.split("/").slice(-1)[0])
    const imgSrc = $derived(pack?.files[0].url)
    const sizeStyle = $derived(
        `width: ${size * 0.25}rem; height: ${size * 0.25}rem;`
    )

    const packURL = $derived(
        `https://splice.com/sounds/packs/${pack?.permalink_base_url}/${pack?.permalink_slug}`
    )
</script>

{#if pack}
    <HoverCard.Root>
        <HoverCard.Trigger
            class="flex-shrink-0"
            onclick={() => pack && openUrl(packURL)}
        >
            <img
                src={imgSrc}
                alt={name}
                class={cn(
                    "rounded-xl border border-white/10 object-cover shadow-lg shadow-black/20",
                    className
                )}
                style={sizeStyle}
                draggable="false"
            />
        </HoverCard.Trigger>
        <HoverCard.Content {side} class="flex flex-col justify-center gap-2">
            <button onclick={() => pack && openUrl(packURL)}>
                <img src={imgSrc} alt={name} class="w-full rounded" />
            </button>
            <p>{name}</p>
        </HoverCard.Content>
    </HoverCard.Root>
{:else}
    <div
        class={cn(
            "rounded-xl flex-shrink-0 bg-white/[0.08] border border-white/10",
            className
        )}
        style={sizeStyle}
    ></div>
{/if}
