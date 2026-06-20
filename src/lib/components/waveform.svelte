<script lang="ts">
    import { loading } from "$lib/shared/loading.svelte"
    import { uid } from "$lib/shared/uid"
    import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
    import pako from "pako"
    import { inview } from "svelte-inview"
    import { cn } from "$lib/utils"

    const key = `progress-gradient-${uid()}`

    let ref = null! as HTMLButtonElement

    let {
        src,
        progress = 0,
        class: className,
        onseek,
    }: {
        src: string
        progress?: number
        class?: string
        onseek: (progress: number) => void
    } = $props()

    let waveform = $state<number[]>(new Array(800).fill(0))

    let loadedSrc = $state("")

    let isLoading = $state(false)

    let isInView = $state(true)

    const loaded = $derived(loadedSrc == src)

    $effect(() => {
        if (!isLoading && !loaded && !loading.fetchError) {
            fetchWaveform()
        }
    })

    function fetchWaveform() {
        isLoading = true
        loading.waveformsCount += 1
        const loadingSrc = src
        fetch(src).catch((err) => {
            console.info("🌐 Browser waveform fetch failed, falling back to Tauri HTTP", err)
            return tauriFetch(src)
        })
            .then((resp) => {
                if (loadingSrc == src) {
                    if (resp.headers.get("content-encoding") == "gzip") {
                        resp.arrayBuffer().then((buff) => {
                            const inflated = pako.inflate(
                                new Uint8Array(buff),
                                {
                                    to: "string",
                                }
                            )
                            waveform = JSON.parse(inflated)
                        })
                    } else {
                        resp.json().then((json) => {
                            waveform = json
                        })
                    }
                    loadedSrc = src
                    loading.waveformsCount -= 1
                    isLoading = false
                } else {
                    console.info("🕜 Ignored stale waveform")
                    loading.waveformsCount -= 1
                    isLoading = false
                }
            })
            .catch((error: Error) => {
                console.error("⚠️ Failed loading waveform", error)
                loading.waveformsCount -= 1
                isLoading = false
            })
    }

    function generateWaveformPath(data: number[]) {
        const pathData = []
        const width = 1000 // Total width of the SVG
        const height = 200 // Total height of the SVG
        const midHeight = height / 2
        const step = width / data.length // Horizontal step size for each data point

        // Top half of the waveform
        pathData.push(`M 0 ${midHeight}`)
        data.forEach((value, index) => {
            const x = index * step
            const y = midHeight - value * midHeight // Flip vertically
            pathData.push(`L ${x} ${y}`)
        })

        // Bottom half (mirrored) of the waveform
        for (let i = data.length - 1; i >= 0; i--) {
            const x = i * step
            const y = midHeight + data[i] * midHeight
            pathData.push(`L ${x} ${y}`)
        }

        pathData.push("Z") // Close the path
        return pathData.join(" ")
    }

    const waveformPath = $derived(generateWaveformPath(waveform))
</script>

<button
    class={cn(
        "waveform-surface overflow-hidden rounded-xl focus:outline-none cursor-grab",
        className
    )}
    use:inview
    tabindex={-1}
    oninview_change={(event) => (isInView = event.detail.inView)}
    onclick={(event) => {
        const rect = ref.getBoundingClientRect()
        progress = (event.clientX - rect.left) / rect.width
        onseek(progress)
    }}
    bind:this={ref}
    aria-label="Waveform"
>
    {#if waveform}
        <svg
            class={cn(
                "size-full opacity-95",
                isInView && "",
                !loaded && "scale-y-0"
            )}
            viewBox={`0 0 1000 200`}
            preserveAspectRatio="none"
        >
            <defs>
                <linearGradient id={key} x1="0" y1="0" x2="1" y2="0">
                    <stop
                        offset={`${progress * 100 || 0}%`}
                        stop-color="rgba(255,255,255,0.96)"
                    />
                    <stop
                        offset={`${progress * 100 || 0}%`}
                        stop-color="rgba(255,255,255,0.36)"
                    />
                </linearGradient>
            </defs>
            <path d={waveformPath} fill={`url(#${key})`} />
        </svg>
    {/if}
</button>
