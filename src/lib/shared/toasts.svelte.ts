export type ToastVariant = "default" | "success" | "error"

export type Toast = {
    id: string
    title: string
    description?: string
    variant: ToastVariant
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
    }
): string {
    const id = crypto.randomUUID()
    toasts.push({
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant ?? "default",
    })
    const duration = opts.duration ?? 10000
    if (duration > 0) {
        setTimeout(() => dismissToast(id), duration)
    }
    return id
}
