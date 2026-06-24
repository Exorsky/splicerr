<script lang="ts">
    import Check from "lucide-svelte/icons/check"
    import * as Command from "$lib/components/ui/command/index.js"
    import * as Popover from "$lib/components/ui/popover/index.js"
    import { Button } from "$lib/components/ui/button/index.js"
    import { cn, formatKey } from "$lib/utils.js"
    import { tick } from "svelte"
    import { keys } from "$lib/shared/store.svelte"
    import ChevronDown from "lucide-svelte/icons/chevron-down"
    import type { ChordType, Key } from "$lib/splice/types"

    let {
        key = $bindable(),
        chord_type = $bindable(),
        onselect,
    }: {
        key: Key | null
        chord_type: ChordType | null
        onselect: () => void
    } = $props()

    const options: { key: Key; chord_type: ChordType | null; label: string }[] =
        [
            ...keys.map((k) => ({
                key: k,
                chord_type: null,
                label: formatKey(k),
            })),
            ...keys.map((k) => ({
                key: k,
                chord_type: "major",
                label: formatKey(k, "major"),
            })),
            ...keys.map((k) => ({
                key: k,
                chord_type: "minor",
                label: formatKey(k, "minor"),
            })),
        ]

    let open = $state(false)
    let triggerRef = $state<HTMLButtonElement>(null!)

    const selectedValue = $derived(
        options.find(
            (option) => option.key === key && option.chord_type == chord_type
        )?.label
    )

    function closeAndFocusTrigger() {
        open = false
        tick().then(() => {
            triggerRef.focus()
        })
    }
</script>

<Popover.Root bind:open>
    <Popover.Trigger bind:ref={triggerRef}>
        {#snippet child({ props })}
            <Button
                variant="outline"
                class={cn(
                    "w-[128px] h-12 rounded-full justify-between hover:bg-white/10",
                    open && "border-ring"
                )}
                {...props}
                role="combobox"
                aria-expanded={open}
            >
                {selectedValue || "Any key"}
                <ChevronDown class="size-4 shrink-0 text-muted-foreground" />
            </Button>
        {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[200px] p-0">
        <Command.Root>
            <Command.Input placeholder="Find key..." />
            <Command.List>
                <Command.Empty>No keys found</Command.Empty>
                <Command.Group>
                    <Command.Item
                        onSelect={() => {
                            key = null
                            chord_type = null
                            closeAndFocusTrigger()
                            onselect()
                        }}
                    >
                        <Check class={cn(key !== null && "text-transparent")} />
                        Any key
                    </Command.Item>
                    {#each options as option}
                        <Command.Item
                            value={`${option.key} ${option.chord_type}`}
                            onSelect={() => {
                                key = option.key
                                chord_type = option.chord_type
                                closeAndFocusTrigger()
                                onselect()
                            }}
                        >
                            <Check
                                class={cn(
                                    (key !== option.key ||
                                        chord_type !== option.chord_type) &&
                                        "text-transparent"
                                )}
                            />
                            {option.label}
                        </Command.Item>
                    {/each}
                </Command.Group>
            </Command.List>
        </Command.Root>
    </Popover.Content>
</Popover.Root>
