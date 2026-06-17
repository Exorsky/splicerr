export type ToastVariant = "default" | "success" | "error" | "destructive"

export type Toast = {
    id: string
    title: string
    description?: string
    variant: ToastVariant
    // When set, the description becomes a clickable action (e.g. reveal a file).
    onClick?: () => void
}

export const toasts = $state<Toast[]>([])

export function dismissToast(id: string) {
    const index = toasts.findIndex((t) => t.id == id)
    if (index != -1) toasts.splice(index, 1)
}

/**
 * Shows a transient toast in the bottom-right stack. Auto-dismisses after
 * `duration` ms (0 to keep it until dismissed). Returns the toast id.
 */
export function toast(
    opts: {
        title: string
        description?: string
        variant?: ToastVariant
        duration?: number
        onClick?: () => void
    }
): string {
    const id = crypto.randomUUID()
    toasts.push({
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant ?? "default",
        onClick: opts.onClick,
    })
    const duration = opts.duration ?? 6000
    if (duration > 0) {
        setTimeout(() => dismissToast(id), duration)
    }
    return id
}
