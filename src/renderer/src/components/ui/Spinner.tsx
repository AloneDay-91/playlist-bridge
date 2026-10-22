import { Icon } from "@/components/Icon"
import { cn } from "@/lib/utils"

function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <span data-slot="spinner" role="status" aria-label="Chargement" className={cn("inline-flex animate-spin", className)}>
      <Icon name="spinner" size={size} />
    </span>
  )
}

export { Spinner }
