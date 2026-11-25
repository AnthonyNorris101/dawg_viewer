import { useInfo } from '../live/connection'
import { mapBackground, useMapBackgroundId } from '../state/mapBackground'

export function MapBackgroundSelect() {
  const sources = useInfo()?.mapSources ?? []
  const id = useMapBackgroundId()
  if (sources.length === 0) return null
  return (
    <label
      className="flex items-center gap-1 text-zinc-500"
      title="Draw the track on a map of the place. The app looks the location up online the first time and keeps the imagery in the config folder (maps/), so it still shows with no internet at the track."
    >
      Map
      <select
        aria-label="Map background"
        className="max-w-36 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
        value={sources.some((s) => s.id === id) ? id : ''}
        onChange={(e) => mapBackground.set(e.target.value)}
      >
        <option value="">Off</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
