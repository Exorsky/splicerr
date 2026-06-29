<script lang="ts">
    import * as HoverCard from "$lib/components/ui/hover-card/index.js"
    import type { PackAsset } from "$lib/splice/types"
    import { openUrl } from "@tauri-apps/plugin-opener"
    import { cn } from "$lib/utils"
    import { onMount } from "svelte"
    import ExternalLink from "lucide-svelte/icons/external-link"

    const {
        pack,
        side = "right",
        size = 12,
        class: className,
        onopenpack,
    }: {
        pack: PackAsset | undefined
        side?: "right" | "top" | "bottom" | "left"
        size?: number
        class?: string
        onopenpack?: (pack: PackAsset) => void
    } = $props()

    const name = $derived(pack?.name.split("/").slice(-1)[0])
    const imgSrc = $derived(pack?.files[0].url)
    let contextMenu = $state<{ x: number; y: number } | null>(null)
    const sizeStyle = $derived(
        `width: ${size * 0.25}rem; height: ${size * 0.25}rem;`
    )

    const packURL = $derived(
        `https://splice.com/sounds/packs/${pack?.permalink_base_url}/${pack?.permalink_slug}`
    )

    const openPackInApp = () => {
        if (!pack) return
        onopenpack?.(pack)
    }

    const openPackOnSplice = () => {
        if (!pack) return
        contextMenu = null
        openUrl(packURL)
    }

    const handleKeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openPackInApp()
        }
    }

    onMount(() => {
        const closeContextMenu = () => (contextMenu = null)
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeContextMenu()
        }
        window.addEventListener("click", closeContextMenu)
        window.addEventListener("keydown", closeOnEscape)
        return () => {
            window.removeEventListener("click", closeContextMenu)
            window.removeEventListener("keydown", closeOnEscape)
        }
    })
</script>

{#if pack}
    <HoverCard.Root>
        <HoverCard.Trigger
            class="flex-shrink-0"
            role="button"
            tabindex={0}
            title="Open pack in Splicerr"
            onclick={(event) => {
                event.stopPropagation()
                openPackInApp()
            }}
            onkeydown={handleKeydown}
            oncontextmenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                contextMenu = { x: event.clientX, y: event.clientY }
            }}
            onmousedown={(event) => event.stopPropagation()}
            ondragstart={(event) => event.preventDefault()}
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
            <button
                title="Open pack in Splicerr"
                onclick={(event) => {
                    event.stopPropagation()
                    openPackInApp()
                }}
                oncontextmenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    contextMenu = { x: event.clientX, y: event.clientY }
                }}
            >
                <img src={imgSrc} alt={name} class="w-full rounded" />
            </button>
            <p>{name}</p>
        </HoverCard.Content>
    </HoverCard.Root>
    {#if contextMenu}
        <button
            class="fixed z-[100] flex items-center gap-2 rounded-md border border-white/10 bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg hover:bg-muted"
            style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
            onclick={(event) => {
                event.stopPropagation()
                openPackOnSplice()
            }}
            oncontextmenu={(event) => event.preventDefault()}
        >
            <ExternalLink size="16" />
            View on Splice
        </button>
    {/if}
{:else}
    <div
        class={cn(
            "rounded-xl flex-shrink-0 bg-white/[0.08] border border-white/10",
            className
        )}
        style={sizeStyle}
    ></div>
{/if}
