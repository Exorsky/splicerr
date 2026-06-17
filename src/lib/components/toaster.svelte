<script lang="ts">
    import { cn } from "$lib/utils"
    import { toasts, dismissToast } from "$lib/shared/toasts.svelte"
    import { fly } from "svelte/transition"
    import { flip } from "svelte/animate"
    import CheckCircle2 from "lucide-svelte/icons/circle-check"
    import CircleAlert from "lucide-svelte/icons/circle-alert"
    import Info from "lucide-svelte/icons/info"
    import Trash2 from "lucide-svelte/icons/trash-2"
    import X from "lucide-svelte/icons/x"

    const icons = {
        success: CheckCircle2,
        error: CircleAlert,
        destructive: Trash2,
        default: Info,
    }
</script>

<div
    class="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 w-[26rem] max-w-[calc(100vw-3rem)] pointer-events-none"
>
    {#each toasts as t (t.id)}
        {@const Icon = icons[t.variant]}
        <div
            class={cn(
                "pointer-events-auto flex items-start gap-3.5 rounded-xl border border-l-4 bg-background p-4 shadow-xl",
                t.variant === "success" && "border-l-green-500",
                (t.variant === "error" || t.variant === "destructive") &&
                    "border-l-destructive",
                t.variant === "default" && "border-l-muted-foreground"
            )}
            in:fly={{ x: 24, duration: 200 }}
            out:fly={{ x: 24, duration: 150 }}
            animate:flip={{ duration: 200 }}
        >
            <Icon
                size="24"
                class={cn(
                    "flex-shrink-0 mt-0.5",
                    t.variant === "success" && "text-green-500",
                    (t.variant === "error" || t.variant === "destructive") &&
                        "text-destructive",
                    t.variant === "default" && "text-muted-foreground"
                )}
            />
            <div class="min-w-0 flex-grow">
                <p class="text-base font-semibold">{t.title}</p>
                {#if t.description}
                    <p class="text-sm text-muted-foreground break-all mt-0.5">
                        {t.description}
                    </p>
                {/if}
            </div>
            <button
                class="flex-shrink-0 text-muted-foreground hover:text-foreground rounded-sm p-1"
                aria-label="Dismiss"
                onclick={() => dismissToast(t.id)}
            >
                <X size="18" />
            </button>
        </div>
    {/each}
</div>
