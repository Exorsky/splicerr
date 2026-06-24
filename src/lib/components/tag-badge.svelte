<script lang="ts">
    import { cn } from "$lib/utils"
    import Button from "$lib/components/ui/button/button.svelte"
    import type { MouseEventHandler } from "svelte/elements"
    import * as Tooltip from "$lib/components/ui/tooltip"

    let {
        class: className,
        active = false,
        label,
        variant = "default",
        count,
        onclick,
    }: {
        class?: string
        active?: boolean
        label: string
        variant?: "default" | "ghost"
        count: number
        onclick: MouseEventHandler<HTMLButtonElement> &
            MouseEventHandler<HTMLAnchorElement>
    } = $props()
</script>

<Tooltip.Provider>
    <Tooltip.Root>
        <Tooltip.Trigger class="focus:outline-none" tabindex={-1}>
            <Button
                class={cn(
                    "glass-pill px-3 min-w-14 h-8 rounded-full justify-center shrink-0 text-xs font-medium",
                    !active && "text-muted-foreground",
                    active && "glass-pill-active",
                    variant == "ghost" &&
                        "text-muted-foreground hover:bg-white/10 border-transparent hover:text-accent-foreground",
                    className
                )}
                variant={active
                    ? "default"
                    : variant == "default"
                      ? "outline"
                      : "ghost"}
                {onclick}
                >{label}
            </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
            <p>{count} Samples</p>
        </Tooltip.Content>
    </Tooltip.Root>
</Tooltip.Provider>
