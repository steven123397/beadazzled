import { vi } from 'vitest';

type VirtualizerOptions = {
  count: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string | number;
};

/** Measure every item synchronously so component tests do not depend on layout. */
export function makeVirtualizer(options: VirtualizerOptions) {
  const sizes = Array.from({ length: options.count }, (_, index) => options.estimateSize(index));
  const starts: number[] = [];
  let total = 0;
  for (const size of sizes) {
    starts.push(total);
    total += size;
  }

  return {
    getTotalSize: () => total,
    getVirtualItems: () =>
      sizes.map((size, index) => ({
        index,
        start: starts[index] ?? 0,
        size,
        key: options.getItemKey(index),
      })),
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
  };
}
