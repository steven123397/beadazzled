import { Command } from 'cmdk';
import { useState } from 'react';

import { GROUP_ORDER, rankCommands, type CommandItem } from './commands';

const RESULT_LIMIT = 50;

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const results = rankCommands(commands, query, RESULT_LIMIT);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 p-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Command
        shouldFilter={false}
        loop
        className="w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-100"
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search commands and tickets"
          className="w-full border-b border-neutral-800 bg-transparent px-3 py-2 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-auto p-1">
          <Command.Empty className="px-3 py-2 text-sm text-neutral-500">
            No matching commands
          </Command.Empty>
          {GROUP_ORDER.map((group) => {
            const items = results.filter((command) => command.group === group);
            if (items.length === 0) {
              return null;
            }
            return (
              <Command.Group
                key={group}
                heading={group}
                className="px-1 py-1 text-xs text-neutral-500"
              >
                {items.map((command) => (
                  <Command.Item
                    key={command.id}
                    value={command.id}
                    onSelect={() => {
                      command.run();
                      onClose();
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-200 data-[selected=true]:bg-neutral-800"
                  >
                    <span className="min-w-0 flex-1 truncate">{command.title}</span>
                    {command.subtitle === undefined ? null : (
                      <span className="font-mono text-xs text-neutral-500">{command.subtitle}</span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}
