/**
 * Times in the app: 12-hour clock and New York time, so nobody has to convert 24-hour numbers.
 * Stored values (posting slots) stay "HH:mm" 24-hour internally; these helpers only show and read them.
 */
export const NY_TZ = 'America/New_York'

/** "20:00" -> "8:00 PM" */
export function slot12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim())
  if (!m) return String(hhmm)
  const h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${suffix}`
}

/** "8:00 AM", "9pm", "8 pm", "20:00" -> "HH:mm" (null when it is not a time). */
export function parseSlot(text: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(text))
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (min > 59) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    const pm = m[3].toLowerCase() === 'p'
    h = (h % 12) + (pm ? 12 : 0)
  } else if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** "8:00 AM, 9 PM, 22:00" -> ["08:00", "21:00", "22:00"] (invalid parts are dropped). */
export function parseSlotList(text: string): string[] {
  return String(text)
    .split(/[,;\n]+/)
    .map((s) => parseSlot(s))
    .filter((s): s is string => !!s)
}

/** ["08:00","20:00"] -> "8:00 AM, 8:00 PM" */
export function slotList12(slots: string[]): string {
  return slots.map(slot12).join(', ')
}

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v))

/** "8:00 AM" in New York time. */
export function fmtNYTime(v: string | number | Date): string {
  return toDate(v).toLocaleTimeString('en-US', { timeZone: NY_TZ, hour: 'numeric', minute: '2-digit', hour12: true })
}

/** "8:00:05 AM" in New York time (logs). */
export function fmtNYTimeSec(v: string | number | Date): string {
  return toDate(v).toLocaleTimeString('en-US', { timeZone: NY_TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
}

/** "Oct 24, 8:00 AM" in New York time. */
export function fmtNYDateTime(v: string | number | Date): string {
  return toDate(v).toLocaleString('en-US', { timeZone: NY_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Value for <input type="datetime-local"> showing New York wall-clock time. */
export function toNYInput(v: string | number | Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(toDate(v))
  const g = (t: string) => p.find((x) => x.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

/** The UTC instant of a New York wall-clock time "YYYY-MM-DD HH:mm" (daylight saving included). */
export function nyInputToDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(text.trim())
  if (!m) return null
  let h = Number(m[4])
  if (m[6]) h = (h % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0)
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5]))
  const offsetMin = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value)
    return Math.round((ms - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'))) / 60000)
  }
  let t = wall + offsetMin(wall) * 60000
  t = wall + offsetMin(t) * 60000
  return new Date(t)
}
