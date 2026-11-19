/**
 * Rows arrive as arrays in column order. These helpers identify a row by its
 * primary key, used for selection, editing and change highlighting.
 */
export function rowKeyFunction({ columns, primaryKey }) {
  if (!primaryKey.length) return (_row, i) => String(i);
  const indexes = primaryKey.map((name) => columns.findIndex((c) => c.name === name));
  return (row) => JSON.stringify(indexes.map((i) => row[i]));
}

/** { column: value } for one row array. */
export function rowObject({ columns }, row) {
  return Object.fromEntries(columns.map((c, i) => [c.name, row[i]]));
}

/** { pkColumn: value } for one row array. */
export function rowKeyObject(data, row) {
  const obj = rowObject(data, row);
  return Object.fromEntries(data.primaryKey.map((name) => [name, obj[name]]));
}
