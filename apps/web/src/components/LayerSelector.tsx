import { LAYERS, type Layer } from '@perifmcp/core'

export function LayerSelector({ layer, onChange }: { layer: Layer; onChange: (layer: Layer) => void }) {
  return (
    <div role="group" aria-label="Layer" className="flex items-center gap-2 text-sm">
      <span className="text-gray-400">layer</span>
      {LAYERS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={layer === l}
          onClick={() => onChange(l)}
          className={`cursor-pointer border px-2 py-1 transition-colors hover:border-brand hover:text-brand ${
            layer === l ? 'border-brand text-brand' : 'border-gray-700 text-gray-400'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
