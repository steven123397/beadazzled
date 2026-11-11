import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVirtualFocus } from './useVirtualFocus';

describe('useVirtualFocus', () => {
  it('scrolls to item and focuses when element appears in DOM', () => {
    const scrollToIndex = vi.fn();
    const virtualizer = {
      scrollToIndex,
      getVirtualItems: vi.fn().mockReturnValue([]),
    };

    const items = [
      { id: 'item-1', label: 'First' },
      { id: 'item-2', label: 'Second' },
    ];

    const element = document.createElement('button');
    element.id = 'el-item-2';
    vi.spyOn(element, 'focus');
    document.body.appendChild(element);

    const { result } = renderHook(() =>
      useVirtualFocus(virtualizer, items, {
        getItemId: (item) => item.id,
        getElementId: (id) => `el-${id}`,
      })
    );

    act(() => {
      result.current.focusItem('item-2');
    });

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' });
    expect(element.focus).toHaveBeenCalledWith({ preventScroll: true });

    document.body.removeChild(element);
  });

  it('ignores focusItem for missing items', () => {
    const scrollToIndex = vi.fn();
    const virtualizer = {
      scrollToIndex,
      getVirtualItems: vi.fn().mockReturnValue([]),
    };

    const items = [{ id: 'item-1', label: 'First' }];

    const { result } = renderHook(() =>
      useVirtualFocus(virtualizer, items, {
        getItemId: (item) => item.id,
        getElementId: (id) => `el-${id}`,
      })
    );

    act(() => {
      result.current.focusItem('item-missing');
    });

    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(result.current.pendingFocusRef.current).toBeNull();
  });

  it('keeps focusItem stable when items and option callbacks change', () => {
    const virtualizer = { scrollToIndex: vi.fn(), getVirtualItems: () => [] };
    const { result, rerender } = renderHook(
      ({ items }) =>
        useVirtualFocus(virtualizer, items, {
          getItemId: (item) => item.id,
          getElementId: (id) => `el-${id}`,
        }),
      { initialProps: { items: [{ id: 'item-1' }] } }
    );
    const firstFocusItem = result.current.focusItem;

    rerender({ items: [{ id: 'item-2' }] });

    expect(result.current.focusItem).toBe(firstFocusItem);
  });

  it('reads the latest items through a previously captured focusItem', () => {
    const scrollToIndex = vi.fn();
    const virtualizer = { scrollToIndex, getVirtualItems: () => [] };
    const { result, rerender } = renderHook(
      ({ items }) =>
        useVirtualFocus(virtualizer, items, {
          getItemId: (item) => item.id,
          getElementId: (id) => `el-${id}`,
        }),
      { initialProps: { items: [{ id: 'item-2' }, { id: 'item-1' }] } }
    );
    const capturedFocusItem = result.current.focusItem;
    rerender({ items: [{ id: 'item-1' }, { id: 'item-2' }] });

    act(() => capturedFocusItem('item-2'));

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' });
  });

  it('focuses a pending item when a delayed render mounts its element', () => {
    let virtualItems: readonly unknown[] = [];
    const virtualizer = { scrollToIndex: vi.fn(), getVirtualItems: () => virtualItems };
    const { result, rerender } = renderHook(() =>
      useVirtualFocus(virtualizer, [{ id: 'item-2' }], {
        getItemId: (item) => item.id,
        getElementId: (id) => `el-${id}`,
      })
    );

    act(() => result.current.focusItem('item-2'));
    expect(result.current.pendingFocusRef.current).toBe('item-2');

    const element = document.createElement('button');
    element.id = 'el-item-2';
    vi.spyOn(element, 'focus');
    document.body.appendChild(element);
    virtualItems = [{ index: 0 }];
    rerender();

    expect(element.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(result.current.pendingFocusRef.current).toBeNull();
    element.remove();
  });

  it('supports an O(1) index resolver', () => {
    const scrollToIndex = vi.fn();
    const virtualizer = { scrollToIndex, getVirtualItems: () => [] };
    const { result } = renderHook(() =>
      useVirtualFocus(virtualizer, [], {
        resolveIndex: () => 0,
        getItemId: () => undefined,
        getElementId: (id) => `el-${id}`,
      })
    );

    act(() => result.current.focusItem('item-2'));

    expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'auto' });
  });
});
