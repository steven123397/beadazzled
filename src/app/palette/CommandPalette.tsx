import { Command } from 'cmdk';
import { useState } from 'react';

import { DialogSurface } from '@/components/ui/modal';
import { useI18n } from '@/lib/i18n/I18nProvider';
import type { MessageKey } from '@/lib/i18n';

import { GROUP_ORDER, rankCommands, type CommandItem } from './commands';

const RESULT_LIMIT = 50;

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly CommandItem[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const results = rankCommands(commands, query, RESULT_LIMIT);

  return (
    <DialogSurface
      aria-label={t('palette.title')}
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 p-6 outline-none"
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
        label={t('palette.placeholder')}
        className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-raised text-foreground"
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t('palette.placeholder')}
          className="w-full border-b border-border bg-transparent px-3 py-2 text-sm"
        />
        <Command.List className="max-h-80 overflow-auto p-1">
          <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">
            {t('palette.empty')}
          </Command.Empty>
          {GROUP_ORDER.map((group) => {
            const items = results.filter((command) => command.group === group);
            if (items.length === 0) {
              return null;
            }
            return (
              <Command.Group
                key={group}
                heading={t(`palette.group.${group}` as MessageKey)}
                className="px-1 py-1 text-xs text-muted-foreground"
              >
                {items.map((command) => (
                  <Command.Item
                    key={command.id}
                    value={command.id}
                    onSelect={() => {
                      command.run();
                      onClose();
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground data-[selected=true]:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate">{command.title}</span>
                    {command.subtitle === undefined ? null : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {command.subtitle}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </DialogSurface>
  );
}
