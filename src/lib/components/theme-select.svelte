<script lang="ts">
    import * as Select from "$lib/components/ui/select/index"

    let {
        value = $bindable(),
        onselect,
    }: { value: string; onselect: () => void } = $props()

    const options = [
        {
            value: "system",
            label: "System",
        },
        {
            value: "dark",
            label: "Dark",
        },
        {
            value: "light",
            label: "I am a clinically insane.",
        },
        {
            value: "dre4moff",
            label: "dre4moff",
        },
    ]

    const triggerContent = $derived(
        options.find((option) => option.value === value)?.label ?? "Theme..."
    )
</script>

<Select.Root
    type="single"
    {value}
    onValueChange={(v) => {
        value = v
        onselect()
    }}
>
    <Select.Trigger class="w-[180px]">{triggerContent}</Select.Trigger>
    <Select.Content>
        {#each options as option}
            <Select.Item value={option.value} label={option.label}
                >{option.label}</Select.Item
            >
        {/each}
    </Select.Content>
</Select.Root>
