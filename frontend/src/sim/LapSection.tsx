import { useState } from 'react'
import { LOSS_ORDER, percentile } from '../analysis/sim/fromlog'
import { LIMIT_LABELS, type LapResult } from '../analysis/sim/lapsim'
import { biquad } from '../analysis/spectrum'
import { formatLapTime } from '../analysis/track'
import { MapBackgroundSelect } from '../components/MapBackgroundSelect'
import { SimChart, type ChartBand, type ChartSeries } from '../components/SimChart'
import { sim, updateSim, type SimSettings, type SimTrackKind } from '../state/sim'
import { toolbarButton, toolbarButtonActive } from '../ui'
import { forwardG } from '../viewer/simChannels'
import { Change, Empty, Stat, NumberInput } from './common'
import {
  BASE_COLOR,
  card,
  field,
  heading,
  KMH,
  LIMIT_COLORS,
  num,
  REAL_COLOR,
  WHATIF_COLOR,
  type SimLog,
} from './shared'
import { SimTrackMap } from './SimTrackMap'
import { importTrack } from './importTrack'
import type { Session } from '../data/session'
import { simSession, type SimPart } from './simSession'
import { LineControls, SavedTracks, TrackSearch } from './TrackTools'
import type { SimLap } from './useSimLap'

const LINE_COLOR = '#34d399'

function bandsOf(r: LapResult): ChartBand[] {
  const out: ChartBand[] = []
  let from = 0
  const n = r.s.length
  for (let i = 1; i <= n; i++) {
    if (i === n || r.limit[i] !== r.limit[from]) {
      out.push({ from: r.s[from], to: r.s[Math.min(i, n - 1)], color: LIMIT_COLORS[r.limit[from]] })
      from = i
    }
  }
  return out
}

const TRACKS: { id: SimTrackKind; label: string }[] = [
  { id: 'log', label: 'A lap from the open log' },
  { id: 'skidpad', label: 'Skidpad' },
  { id: 'accel', label: 'Acceleration (75 m)' },
  { id: 'custom', label: 'A track I type in or import (OptimumLap)' },
  { id: 'path', label: 'A track outline (from a file or found online)' },
]

export function LapSection({
  log,
  settings,
  data,
  onView,
}: {
  log: SimLog | null
  settings: SimSettings
  data: SimLap
  onView?: (session: Session) => void
}) {
  const [colorBy, setColorBy] = useState<'limit' | 'speed'>('limit')
  const [imported, setImported] = useState({ kind: '', text: '' })
  const { track, result, variantResult, correlation, lap, line, pace } = data
  const off = pace
    ? `${(Math.abs(pace.ratio - 1) * 100).toFixed(1)}% ${pace.ratio >= 1 ? 'slower' : 'faster'}`
    : ''
  const canLine =
    settings.track === 'custom' || settings.track === 'path' || settings.track === 'log'
  const runImport = () =>
    void importTrack(settings).then((text) => setImported({ kind: sim.get().track, text }))
  const inputs = log?.inputs ?? null
  const view = () => {
    if (!track || !result || !onView) return
    const parts: SimPart[] = [
      {
        label:
          settings.track === 'log'
            ? `lap ${lap?.label ?? ''} of ${log?.name ?? 'the log'}, simulated on the line it was driven`
            : line
              ? 'the middle of the track'
              : track.name,
        track,
        result,
      },
    ]
    if (line && line.base !== track)
      parts.push({
        label: 'the driven line from GPS',
        track: line.base,
        result: line.baseResult,
      })
    if (line)
      parts.push({
        label: 'the ideal line',
        track: line.track,
        result: line.result,
        offset: line.offset,
      })
    if (variantResult) parts.push({ label: 'the what-if car', track, result: variantResult })
    const made = simSession(`Simulated · ${track.name}`, parts)
    if (made) onView(made)
  }

  const series: ChartSeries[] = []
  if (result) {
    series.push({
      label: 'Simulated · theoretical',
      color: BASE_COLOR,
      x: result.s,
      y: Array.from(result.v, (v) => v * KMH),
      unit: 'km/h',
      width: 2,
    })
    if (variantResult)
      series.push({
        label: 'What-if',
        color: WHATIF_COLOR,
        dash: '5 4',
        x: variantResult.s,
        y: Array.from(variantResult.v, (v) => v * KMH),
        unit: 'km/h',
      })
    if (correlation)
      series.push({
        label: `Real lap ${lap?.label ?? ''} · measured`,
        color: REAL_COLOR,
        x: result.s,
        y: Array.from(correlation.real, (v) => v * KMH),
        unit: 'km/h',
      })
    if (line)
      series.push({
        label: 'Ideal line · theoretical',
        color: LINE_COLOR,
        x: line.along,
        y: Array.from(line.result.v, (v) => v * KMH),
        unit: 'km/h',
        width: 2,
      })
  }

  const envelope = (() => {
    if (!correlation || !inputs || !lap || !result) return null
    const rate =
      (lap.end - lap.start) / Math.max(1e-6, inputs.time[lap.end] - inputs.time[lap.start])
    const slice = (a: Float64Array | null) =>
      a
        ? biquad(
            Float64Array.from(a.subarray(lap.start, lap.end + 1), (v) =>
              Number.isFinite(v) ? v : 0,
            ),
            rate,
            2,
            'low',
          )
        : null
    const lat = slice(inputs.latG)
    const long = slice(forwardG(inputs))
    const p98 = (a: ArrayLike<number>, f: (v: number) => number) =>
      percentile(Float64Array.from(a, f), 0.98)
    return [
      { name: 'Cornering', real: lat ? p98(lat, Math.abs) : NaN, model: p98(result.ay, Math.abs) },
      {
        name: 'Braking',
        real: long ? p98(long, (v) => -v) : NaN,
        model: p98(result.ax, (v) => -v),
      },
      {
        name: 'Accelerating',
        real: long ? p98(long, (v) => v) : NaN,
        model: p98(result.ax, (v) => v),
      },
    ]
  })()

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={heading}>Track</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Track to simulate"
            className={field}
            value={settings.track}
            onChange={(e) => updateSim({ track: e.target.value as SimTrackKind })}
          >
            {TRACKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {settings.track === 'log' && data.timed.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-zinc-400">
                Lap
                <select
                  aria-label="Lap to simulate"
                  className={field}
                  value={lap?.key ?? ''}
                  onChange={(e) => updateSim({ lapKey: e.target.value })}
                >
                  {data.timed.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label} · {formatLapTime(l.time)}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="flex items-center gap-1.5 text-zinc-400"
                title="How the corner radius along the lap is worked out. Lateral g ÷ speed² follows the car closely, slaloms included; the GPS path needs a clean position signal."
              >
                Corners from
                <select
                  aria-label="Where corner radius comes from"
                  className={field}
                  value={settings.curvature}
                  onChange={(e) =>
                    updateSim({ curvature: e.target.value as SimSettings['curvature'] })
                  }
                >
                  <option value="auto">Automatic</option>
                  <option value="accel">Lateral g and speed</option>
                  <option value="gps">GPS path</option>
                </select>
              </label>
              <label
                className="flex items-center gap-1.5 text-zinc-400"
                title="Distance the corner radius is averaged over. Larger hides sensor noise but rounds off tight corners."
              >
                Smooth over
                <NumberInput
                  label="Track smoothing in metres"
                  min={0}
                  max={30}
                  step={1}
                  className={`${field} w-16`}
                  value={settings.smooth}
                  onCommit={(v) => updateSim({ smooth: v })}
                />
                m
              </label>
            </>
          )}
          {settings.track === 'path' && settings.path && (
            <label
              className="flex items-center gap-1.5 text-zinc-400"
              title="Distance the outline is averaged over before corner radii are worked out. Use a few metres for a path recorded by GPS; leave it at 0 for a drawn or surveyed outline."
            >
              Smooth over
              <NumberInput
                label="Outline smoothing in metres"
                min={0}
                max={30}
                step={1}
                className={`${field} w-16`}
                value={settings.path.smooth ?? 0}
                onCommit={(v) =>
                  settings.path && updateSim({ path: { ...settings.path, smooth: v } })
                }
              />
              m
            </label>
          )}
          {settings.track === 'custom' && (
            <label className="flex items-center gap-1.5 text-zinc-400">
              <input
                type="checkbox"
                checked={settings.customClosed}
                onChange={(e) => updateSim({ customClosed: e.target.checked })}
              />
              Closed loop (flying lap)
            </label>
          )}
          {(settings.track === 'custom' || settings.track === 'path') && (
            <button
              type="button"
              className={toolbarButton}
              title="An OptimumLap track (.OLTra), a table of sections (Straight, Left or Right with length and radius), or an outline as points (x and y, latitude and longitude, GPX, KML or GeoJSON)"
              onClick={runImport}
            >
              Import track file…
            </button>
          )}
        </div>
        {imported.text && imported.kind === settings.track && (
          <p className="text-zinc-400">{imported.text}</p>
        )}
        {settings.track === 'path' && <TrackSearch log={log} settings={settings} />}
        {settings.track === 'custom' && (
          <>
            <textarea
              aria-label="Track description"
              spellCheck={false}
              className={`${field} h-40 w-full font-mono text-xs`}
              value={settings.custom}
              onChange={(e) => updateSim({ custom: e.target.value })}
            />
            {data.errors.map((e) => (
              <p key={e} className="text-amber-300">
                {e}
              </p>
            ))}
          </>
        )}
        {track && (
          <p className="text-zinc-400">
            {track.name}: {num(track.length, 0)} m,{' '}
            {track.standing ? 'standing start' : track.closed ? 'flying lap' : 'rolling start'}.
            {settings.track === 'log' &&
              ' The simulated car follows the line this lap was driven on, as fast as the car on the Car tab can.'}
          </p>
        )}
        {data.problem && <p className="text-amber-300">{data.problem}</p>}
        {canLine && track && <LineControls settings={settings} data={data} />}
        <SavedTracks log={log} settings={settings} data={data} />
      </section>

      {!track || !result ? (
        <Empty>No track to simulate yet.</Empty>
      ) : (
        <>
          {onView && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={toolbarButton}
                title="Opens this simulated lap as a log in the Viewer, with speed, g, rpm, gear, throttle and position channels. With the ideal line or a what-if car on, each is its own lap so the Viewer can overlay them."
                onClick={view}
              >
                View this simulated lap in the Viewer
              </button>
              <span className="text-xs text-zinc-500">
                Every channel there is marked theoretical. The log you have open stays the one this
                tab compares against.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-zinc-800 px-3 py-2">
              <div className={heading}>Simulated lap</div>
              <div className="text-xl font-semibold tabular-nums">{formatLapTime(result.time)}</div>
              {variantResult && (
                <div className="text-xs tabular-nums">
                  <span style={{ color: WHATIF_COLOR }}>
                    What-if {formatLapTime(variantResult.time)}
                  </span>{' '}
                  <Change base={result.time} other={variantResult.time} digits={3} unit="s" />
                </div>
              )}
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-800 px-3 py-2">
              <div className={heading}>
                {correlation || !pace ? 'Real lap' : 'Likely lap · calculated'}
              </div>
              <div className="text-xl font-semibold tabular-nums">
                {correlation
                  ? formatLapTime(correlation.realTime)
                  : pace
                    ? formatLapTime((line ? line.result.time : result.time) * pace.ratio)
                    : '–'}
              </div>
              <div className="text-xs text-zinc-500 tabular-nums">
                {correlation ? (
                  <>
                    {correlation.gap >= 0 ? '+' : '−'}
                    {Math.abs(correlation.gap).toFixed(3)} s (
                    {((correlation.gap / correlation.simTime) * 100).toFixed(1)}%) against the
                    simulation
                  </>
                ) : pace ? (
                  <>
                    {line ? 'the ideal line' : 'the simulated lap'} at the pace of lap {pace.lap} in
                    the open log, which was {off} than its own simulation
                  </>
                ) : (
                  'pick a lap from a log to compare'
                )}
              </div>
            </div>
            <Stat
              label="Fastest point"
              value={result.vMax * KMH}
              unit="km/h"
              digits={0}
              other={variantResult ? variantResult.vMax * KMH : null}
              lowerIsBetter={false}
            />
            <Stat
              label="Slowest point"
              value={result.vMin * KMH}
              unit="km/h"
              digits={0}
              other={variantResult ? variantResult.vMin * KMH : null}
              lowerIsBetter={false}
            />
          </div>

          {line && (
            <section className={card}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={heading}>Ideal line</h2>
                <span className="rounded bg-zinc-700/60 px-1 text-[9px] tracking-wide text-zinc-300 uppercase">
                  theoretical
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat
                  label={line.driven ? 'Driven line (GPS path)' : 'Middle of the track'}
                  value={line.baseResult.time}
                  unit="s"
                  digits={3}
                />
                <div className="min-w-0 rounded-lg border border-zinc-800 px-3 py-2">
                  <div className={heading}>Ideal line</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {num(line.result.time, 3)}{' '}
                    <span className="text-sm font-normal text-zinc-500">s</span>
                  </div>
                  <div className="text-xs tabular-nums">
                    <Change
                      base={line.baseResult.time}
                      other={line.result.time}
                      digits={3}
                      unit="s"
                    />{' '}
                    <span className="text-zinc-500">
                      (
                      {(
                        ((line.result.time - line.baseResult.time) / line.baseResult.time) *
                        100
                      ).toFixed(1)}
                      %)
                    </span>
                  </div>
                </div>
                <Stat
                  label="Distance"
                  value={line.track.length}
                  unit="m"
                  digits={1}
                  note={`${num(line.base.length, 1)} m ${line.driven ? 'as driven' : 'down the middle'}`}
                />
                <Stat
                  label="Slowest point"
                  value={line.result.vMin * KMH}
                  unit="km/h"
                  digits={0}
                  note={`${num(line.baseResult.vMin * KMH, 0)} km/h ${line.driven ? 'as driven' : 'down the middle'}`}
                />
              </div>
              <SimChart
                series={[
                  {
                    label:
                      'Ideal line, metres left of the ' + (line.driven ? 'driven line' : 'middle'),
                    color: LINE_COLOR,
                    x: line.along,
                    y: line.offset,
                    unit: 'm',
                  },
                ]}
                xLabel="Distance (m)"
                yLabel="Left (+) or right (−), m"
                zero
                height={150}
                label="Where the ideal line sits across the track, against distance"
              />
              <p className="text-zinc-400">
                The app tried {line.tried} lines that fit in the room given, from the smoothest
                (least total cornering) to shorter ones that cut more distance, ran the car on the
                Car tab down each and kept the quickest.{' '}
                {line.driven
                  ? `The car’s centre may move ${num(line.room, 2)} m to either side of the path the GPS recorded, so GPS error counts as room. Both times here use the shape of the GPS path, which is why the driven-line time differs from the simulated lap above when that follows lateral g.`
                  : `The car’s centre stays ${num(line.room, 2)} m or less from the middle of the track.`}{' '}
                It is a close stand-in for the fastest line, not a proof of it, and the time carries
                every assumption in the tire and car model.
              </p>
              {line.driven && correlation ? (
                <p className="text-zinc-400 tabular-nums">
                  Likely lap: if the driver gained the same share on the real car, lap {lap?.label}{' '}
                  would go from {formatLapTime(correlation.realTime)} to about{' '}
                  <span className="text-zinc-200">
                    {formatLapTime(
                      (correlation.realTime * line.result.time) / line.baseResult.time,
                    )}
                  </span>
                  . That is the measured lap time scaled by the simulated gain.
                </p>
              ) : !line.driven && pace ? (
                <p className="text-zinc-400 tabular-nums">
                  Likely lap: lap {pace.lap} of the open log took {formatLapTime(pace.real)} against{' '}
                  {formatLapTime(pace.sim)} simulated on the line it was driven, {off}. At that pace
                  this track would take about{' '}
                  <span className="text-zinc-200">
                    {formatLapTime(line.result.time * pace.ratio)}
                  </span>{' '}
                  on the ideal line and {formatLapTime(line.baseResult.time * pace.ratio)} down the
                  middle. The gap between a driver and the simulation changes from track to track,
                  so read this as a rough guide.
                </p>
              ) : null}
            </section>
          )}

          <section className={card}>
            <h2 className={heading}>Speed around the lap</h2>
            <SimChart
              series={series}
              xLabel="Distance (m)"
              yLabel="Speed (km/h)"
              zero
              height={300}
              bands={bandsOf(result)}
              bandLegend={LIMIT_LABELS.map((l, i) => ({ label: l, color: LIMIT_COLORS[i] }))}
              label="Simulated and real speed against distance"
            />
            <p className="text-zinc-400">
              The strip under the plot shows what holds the simulated car back at each point. Shares
              of the lap:{' '}
              {LIMIT_LABELS.map(
                (l, i) => `${l.toLowerCase()} ${(result.share[i] * 100).toFixed(0)}%`,
              )
                .filter((_, i) => result.share[i] > 0.005)
                .join(', ')}
              .
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={line ? `${card} lg:col-span-2` : card}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={heading}>Track map</h2>
                <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                  {(['limit', 'speed'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={colorBy === c ? toolbarButtonActive : toolbarButton}
                      onClick={() => setColorBy(c)}
                    >
                      {c === 'limit' ? 'What limits the car' : 'Speed'}
                    </button>
                  ))}
                  {track.origin && <MapBackgroundSelect />}
                </span>
              </div>
              <SimTrackMap
                track={line ? line.base : track}
                result={line ? line.baseResult : result}
                colorBy={colorBy}
                line={
                  line
                    ? {
                        track: line.track,
                        result: line.result,
                        band: 2 * line.room + data.carWidth,
                      }
                    : null
                }
              />
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                {colorBy === 'limit'
                  ? LIMIT_LABELS.map((l, i) => (
                      <span key={l} className="flex items-center gap-1">
                        <span
                          className="inline-block h-2 w-2 rounded-sm"
                          style={{ background: LIMIT_COLORS[i] }}
                        />
                        {l}
                      </span>
                    ))
                  : `Blue is ${num(result.vMin * KMH, 0)} km/h, red is ${num(result.vMax * KMH, 0)} km/h.`}
                <span>The white dot is the start.</span>
                {line && (
                  <span>
                    The coloured line is the ideal line, the dashed one is{' '}
                    {line.driven ? 'the driven line' : 'the middle of the track'} and the pale band
                    is the room the car has.
                  </span>
                )}
              </p>
            </section>

            <section className={card}>
              <h2 className={heading}>Where the real lap loses time</h2>
              {!correlation ? (
                <Empty>
                  Pick “A lap from the open log” to see where the real car is off the simulated one.
                </Empty>
              ) : (
                <>
                  <table className="w-full tabular-nums">
                    <thead className="text-zinc-500">
                      <tr className="text-right">
                        <th className="text-left font-normal">While the simulated car is…</th>
                        <th className="font-normal">Share of lap</th>
                        <th className="font-normal">Real − simulated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LOSS_ORDER.filter((c) => result.share[c] > 0.002).map((c) => (
                        <tr key={c} className="text-right">
                          <td className="flex items-center gap-1.5 text-left text-zinc-300">
                            <span
                              className="inline-block h-2 w-2 rounded-sm"
                              style={{ background: LIMIT_COLORS[c] }}
                            />
                            {LIMIT_LABELS[c]}
                          </td>
                          <td>{(result.share[c] * 100).toFixed(0)}%</td>
                          <td>
                            <Change base={0} other={correlation.loss[c]} digits={2} unit="s" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <SimChart
                    series={[
                      {
                        label: 'Time lost so far',
                        color: REAL_COLOR,
                        x: result.s,
                        y: correlation.delta,
                        unit: 's',
                      },
                    ]}
                    xLabel="Distance (m)"
                    yLabel="Real − simulated (s)"
                    height={170}
                    label="Time the real lap has lost to the simulation, against distance"
                  />
                  <p className="text-zinc-400 tabular-nums">
                    {correlation.r2 > 0
                      ? `The speed traces match with R² ${num(correlation.r2, 2)}. `
                      : 'The two speed traces do not line up yet, so tune the car on the Car tab first. '}
                    The real car is on average {num(Math.abs(correlation.bias) * KMH, 1)} km/h{' '}
                    {correlation.bias <= 0 ? 'slower' : 'faster'} (RMS difference{' '}
                    {num(correlation.rms * KMH, 1)} km/h) and within 3% of the simulated speed, or
                    above it, for {(correlation.atLimit * 100).toFixed(0)}% of the lap.
                  </p>
                </>
              )}
            </section>
          </div>

          {envelope && (
            <section className={card}>
              <h2 className={heading}>Is the car on the Car tab right? Model against this lap</h2>
              <table className="w-full max-w-2xl tabular-nums">
                <thead className="text-zinc-500">
                  <tr className="text-right">
                    <th className="text-left font-normal" />
                    <th className="font-normal">Most the real car pulled</th>
                    <th className="font-normal">Most the simulated car pulled</th>
                    <th className="font-normal">Real ÷ simulated</th>
                  </tr>
                </thead>
                <tbody>
                  {envelope.map((e) => (
                    <tr key={e.name} className="text-right">
                      <td className="text-left text-zinc-300">{e.name}</td>
                      <td>{num(e.real, 2)} g</td>
                      <td>{num(e.model, 2)} g</td>
                      <td>
                        {Number.isFinite(e.real)
                          ? `${((e.real / e.model) * 100).toFixed(0)}%`
                          : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-zinc-400">
                Both columns are the 98th percentile over this lap, with the real accelerometer
                smoothed to 2 Hz so vibration is not counted as grip. Well over 100% means the car
                on the Car tab is too pessimistic there: raise the tire μ (or ClA, or the torque
                curve for accelerating) until the best laps sit just under the simulation. Well
                under 100% in one row only points at the driver or the setup rather than the model.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
