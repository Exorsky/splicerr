<script lang="ts">
    import "../app.css"
    import { ModeWatcher } from "mode-watcher"
    import { getCurrentWebview } from "@tauri-apps/api/webview"
    import {
        config,
        isSamplesDirValid,
        loadConfig,
        settingsDialog,
    } from "$lib/shared/config.svelte"
    import { loadCollections } from "$lib/shared/collections.svelte"
    import { startDawSync, stopDawSync } from "$lib/shared/daw-sync.svelte"
    import Toaster from "$lib/components/toaster.svelte"
    import { onMount } from "svelte"

    let { children } = $props()

    const DEFAULT_SCALE = 0.8

    $effect(() => {
        getCurrentWebview().setZoom(config.ui_scale * DEFAULT_SCALE)
    })

    onMount(() => {
        const preventFileNavigation = (event: DragEvent) => {
            const types = Array.from(event.dataTransfer?.types ?? [])
            if (
                types.includes("Files") ||
                types.includes("text/uri-list") ||
                types.includes("public.file-url")
            ) {
                event.preventDefault()
                event.stopPropagation()
            }
        }

        window.addEventListener("dragover", preventFileNavigation, true)
        window.addEventListener("drop", preventFileNavigation, true)

        loadConfig().then(() => {
            if (!isSamplesDirValid()) {
                settingsDialog.open = true
            }
        })
        loadCollections()
        startDawSync()
        return () => {
            window.removeEventListener("dragover", preventFileNavigation, true)
            window.removeEventListener("drop", preventFileNavigation, true)
            stopDawSync()
        }
    })
</script>

<ModeWatcher />
{@render children?.()}
<Toaster />
