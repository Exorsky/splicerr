<script lang="ts">
    import * as Select from "$lib/components/ui/select/index"
    import ChevronDown from "lucide-svelte/icons/chevron-down"
    import { cn } from "$lib/utils"
    import type { SortOrder } from "$lib/splice/types"

    let {
        sort = $bindable(),
        onselect,
        order,
    }: {
        sort: string
        onselect: () => void
        order: SortOrder
    } = $props()

    const options = [
        {
            value: "random",
            label: "Random",
        },
        {
            value: "relevance",
            label: "Most relevant",
        },
        {
            value: "popularity",
            label: "Most popular",
        },
        {
            value: "recency",
            label: "Most recent",
        },
    ]

    const ordered = [
        {
            value: "name",
            label: "Filename",
        },
        {
            value: "duration",
            label: "Time",
        },
        {
            value: "key",
            label: "Key",
        },
        {
            value: "bpm",
            label: "BPM",
        },
    ]

    let triggerLabel = $state("")
    let showOrder = $state(false)

    $effect(() => {
        const orderedLabel = ordered.find(
            (option) => option.value === sort
        )?.label
        if (orderedLabel) {
            triggerLabel = orderedLabel
            showOrder = true
        } else {
            triggerLabel =
                options.find((option) => option.value === sort)?.label ??
                "Sort by..."
            showOrder = false
        }
    })
</script>

<Select.Root type="single" bind:value={sort} onValueChange={() => onselect()}>
    <Select.Trigger class="w-[190px]">
        <div class="flex items-center">
            {triggerLabel}
            {#if showOrder}
                <ChevronDown
                    size="18"
                    class={cn(
                        "transition-transform ease-in-out",
                        order == "ASC" ? "rotate-[-180deg]" : ""
                    )}
                />
            {/if}
        </div>
    </Select.Trigger>
    <Select.Content>
        <Select.Group>
            <Select.GroupHeading
                class="text-xs text-muted-foreground font-normal"
                >Sort by</Select.GroupHeading
            >
            {#each options as option}
                <Select.Item value={option.value} label={option.label}
                    >{option.label}</Select.Item
                >
            {/each}
        </Select.Group>
    </Select.Content>
</Select.Root>
