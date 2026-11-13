const adaptRow = (row, index, metricKey) => ({ ...row, id: index, value: row[metricKey], __sourceRow: row });

// Apply the chosen time window before the display limit so late dates remain visible.
export function chartSourceRows(data, interaction = null) {
  return interaction?.dimension?.type === 'date' && interaction.selection?.kind === 'range'
    ? data.rows.filter(row => interaction.isSelected(row))
    : data.rows;
}

export function chartSeriesRows(data, metricKey, interaction = null, type = 'bar') {
  const source = chartSourceRows(data, interaction);
  if (type === 'line') return sampleLineRows(source.map((row, index) => adaptRow(row, index, metricKey)));
  return source.slice(0, 200).map((row, index) => adaptRow(row, index, metricKey));
}

// Min/max sampling covers the whole series, including endpoints and a missing
// value in each bucket. Keep source indices so a compact overview keeps time spacing.
export function sampleLineRows(rows, limit = 2000) {
  if (rows.length <= limit) return rows;
  const buckets = Math.max(1, Math.floor((limit - 2) / 3));
  const chosen = new Set([0, rows.length - 1]);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * (rows.length - 2) / buckets);
    const end = 1 + Math.floor((bucket + 1) * (rows.length - 2) / buckets);
    let min = -1, max = -1, missing = -1;
    for (let index = start; index < end; index++) {
      const value = rows[index].value;
      if (value == null || !Number.isFinite(value)) { if (missing < 0) missing = index; continue; }
      if (min < 0 || value < rows[min].value) min = index;
      if (max < 0 || value > rows[max].value) max = index;
    }
    for (const index of [min, max, missing]) if (index >= 0) chosen.add(index);
  }
  return [...chosen].sort((a, b) => a - b).map(index => rows[index]);
}

// The overview uses all non-Brush-filtered rows, even when the main chart is capped.
export function chartTimelineRows(data, metricKey, dimension) {
  return data.rows.map((row, index) => ({
    ...adaptRow(row, index, metricKey),
    name: String(row[dimension?.key] ?? row.name),
  })).sort((a, b) => a.name.localeCompare(b.name)).map((row, id) => ({ ...row, id }));
}

// Recharts resets its internal Brush indices whenever its data reference changes.
// Equivalent grouped results must therefore keep the existing overview reference.
export function stableTimelineRows(previous, next) {
  return previous?.length === next.length && next.every((row, index) => row.name === previous[index].name && Object.is(row.value, previous[index].value))
    ? previous
    : next;
}

const labelWidth = value => [...String(value ?? '')].reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 12 : 7), 0);

export function chartAxisLayout(rows, viewportWidth, valueLabelWidth = 48) {
  const width = Math.max(1, viewportWidth || 800);
  const count = Math.max(1, rows.length);
  const longest = Math.max(0, ...rows.map(row => labelWidth(row.name)));
  const available = Math.max(1, width - valueLabelWidth - 32);
  const rotated = count > 1 && available / count < longest + 14;
  const angle = rotated ? -40 : 0;
  const radians = Math.abs(angle) * Math.PI / 180;
  const slot = rotated ? Math.max(38, Math.ceil(longest * Math.cos(radians) + 12 * Math.sin(radians) + 12)) : longest + 14;
  return {
    interval: 0,
    angle,
    textAnchor: rotated ? 'end' : 'middle',
    height: rotated ? Math.max(48, Math.ceil(longest * Math.sin(radians) + 26)) : 38,
    minWidth: Math.max(width, Math.ceil(count * slot + valueLabelWidth + 32)),
  };
}
