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
    import Toaster from "$lib/components/toaster.svelte"
    import { onMount } from "svelte"

    let { children } = $props()

    const DEFAULT_SCALE = 0.8

    $effect(() => {
        getCurrentWebview().setZoom(config.ui_scale * DEFAULT_SCALE)
    })

    onMount(() => {
        loadConfig().then(() => {
            if (!isSamplesDirValid()) {
                settingsDialog.open = true
            }
        })
        loadCollections()
    })
</script>

<ModeWatcher />
{@render children?.()}
<Toaster />
