export function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" className="group inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-checked:bg-primary" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="size-4 rounded-full bg-background shadow-xs transition-transform duration-150 group-aria-checked:translate-x-4 motion-reduce:transition-none" aria-hidden="true" />
    </button>
  )
}
