// Grouping rows loaded in one query by the row they belong to, so joining them back up is one pass
// instead of a scan of every row per parent (which gets slow fast with a big catalog).

/** Rows by key, in the order they came. */
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
