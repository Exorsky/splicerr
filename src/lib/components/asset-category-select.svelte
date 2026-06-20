<script lang="ts">
    import * as Select from "$lib/components/ui/select/index"

    let {
        asset_category_slug = $bindable(),
        onselect,
    }: { asset_category_slug: string | null; onselect: () => void } = $props()

    const options = [
        {
            value: "null",
            label: "One-Shots & Loops",
        },
        {
            value: "loop",
            label: "Loops",
        },
        {
            value: "oneshot",
            label: "One-Shots",
        },
    ]

    const triggerContent = $derived(
        options.find((option) => option.value === value)?.label ?? "Category..."
    )

    const value = $derived(
        asset_category_slug == null ? "null" : asset_category_slug
    )
</script>

<Select.Root
    type="single"
    {value}
    onValueChange={(v) => {
        asset_category_slug = v == "null" ? null : v
        onselect()
    }}
>
    <Select.Trigger class="w-[190px]">{triggerContent}</Select.Trigger>
    <Select.Content>
        <Select.Group>
            <Select.GroupHeading
                class="text-xs text-muted-foreground font-normal"
                >Category</Select.GroupHeading
            >
            {#each options as option}
                <Select.Item value={option.value} label={option.label}
                    >{option.label}</Select.Item
                >
            {/each}
        </Select.Group>
    </Select.Content>
</Select.Root>
