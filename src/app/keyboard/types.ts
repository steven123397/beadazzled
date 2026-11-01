export type ShortcutGroup = 'General' | 'Navigation' | 'Views' | 'Data' | 'Help';

export type Shortcut = {
  id: string;
  /** `'mod+k'` or a chord like `['g', 'l']`; `mod` means Ctrl on Windows. */
  keys: string | readonly string[];
  label: string;
  group: ShortcutGroup;
  /** Single-key shortcuts are suppressed in text fields unless this is true. */
  allowInInput?: boolean;
  /** Shortcut is inactive while this returns false, e.g. while an overlay is open. */
  when?: () => boolean;
  run: (context: ShortcutContext) => void;
};

export type ShortcutContext = {
  navigate: (path: string) => void;
  openPalette: () => void;
  closeOverlay: () => void;
  refresh: () => void;
  toggleSidebar: () => void;
};
