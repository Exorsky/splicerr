<script lang="ts">
    import { cn } from "$lib/utils"
    import { toasts, dismissToast } from "$lib/shared/toasts.svelte"
    import { fly } from "svelte/transition"
    import { flip } from "svelte/animate"
    import CheckCircle2 from "lucide-svelte/icons/circle-check"
    import CircleAlert from "lucide-svelte/icons/circle-alert"
    import Info from "lucide-svelte/icons/info"
    import X from "lucide-svelte/icons/x"

    const icons = {
        success: CheckCircle2,
        error: CircleAlert,
        default: Info,
    }
</script>

<div
    class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
>
    {#each toasts as t (t.id)}
        {@const Icon = icons[t.variant]}
        <div
            class="pointer-events-auto flex items-start gap-3 rounded-lg border bg-background p-3 shadow-lg"
            in:fly={{ x: 24, duration: 200 }}
            out:fly={{ x: 24, duration: 150 }}
            animate:flip={{ duration: 200 }}
        >
            <Icon
                size="18"
                class={cn(
                    "flex-shrink-0 mt-0.5",
                    t.variant === "success" && "text-green-500",
                    t.variant === "error" && "text-destructive",
                    t.variant === "default" && "text-muted-foreground"
                )}
            />
            <div class="min-w-0 flex-grow">
                <p class="text-sm font-medium">{t.title}</p>
                {#if t.description}
                    <p class="text-xs text-muted-foreground break-all">
                        {t.description}
                    </p>
                {/if}
            </div>
            <button
                class="flex-shrink-0 text-muted-foreground hover:text-foreground rounded-sm p-0.5"
                aria-label="Dismiss"
                onclick={() => dismissToast(t.id)}
            >
                <X size="14" />
            </button>
        </div>
    {/each}
</div>
