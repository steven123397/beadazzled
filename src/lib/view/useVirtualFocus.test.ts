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
});
