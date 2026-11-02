import type { Issue } from '@/bindings/bd';
import { LANGUAGES, type Language, type MessageKey } from '@/lib/i18n';
import { nextTheme, type Theme } from '@/lib/theme/theme';

export type CommandGroup = 'Navigation' | 'Actions' | 'Issues';

export type CommandItem = {
  id: string;
  title: string;
  subtitle?: string;
  group: CommandGroup;
  /** Extra searchable text: ids, labels, aliases. */
  keywords?: string;
  run: () => void;
};

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type PaletteContext = {
  navigate: (path: string) => void;
  refresh: () => void;
  copyDiagnostics: () => void;
  project: { projectId: string } | null;
  t: Translate;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  language: Language;
  setLanguage: (language: Language) => void;
};

export const GROUP_ORDER: CommandGroup[] = ['Navigation', 'Actions', 'Issues'];

/** Builds the palette's static commands plus one entry per known ticket. */
export function buildCommands(issues: readonly Issue[], context: PaletteContext): CommandItem[] {
  const { t } = context;
  const commands: CommandItem[] = [];

  if (context.project !== null) {
    const projectId = context.project.projectId;
    commands.push(
      {
        id: 'nav:list',
        title: t('shortcut.list'),
        group: 'Navigation',
        keywords: 'issues tickets list',
        run: () => context.navigate(`/w/${projectId}/list`),
      },
      {
        id: 'nav:board',
        title: t('shortcut.board'),
        group: 'Navigation',
        keywords: 'columns kanban board',
        run: () => context.navigate(`/w/${projectId}/board`),
      }
    );
  }

  commands.push(
    {
      id: 'nav:settings',
      title: t('shortcut.settings'),
      group: 'Navigation',
      keywords: 'preferences config',
      run: () => context.navigate('/settings'),
    },
    {
      id: 'action:refresh',
      title: t('shortcut.refresh'),
      group: 'Actions',
      keywords: 'reload sync journal workspace',
      run: context.refresh,
    },
    {
      id: 'action:diagnostics',
      title: t('palette.diagnostics'),
      group: 'Actions',
      keywords: 'copy debug status bd workspace',
      run: context.copyDiagnostics,
    },
    {
      id: 'action:theme',
      title: t('palette.theme', { theme: t(`theme.${context.theme}` as MessageKey) }),
      group: 'Actions',
      keywords: 'theme dark light system appearance',
      run: () => context.setTheme(nextTheme(context.theme)),
    },
    {
      id: 'action:language',
      title: t('palette.language', {
        language: t(`language.${context.language}` as MessageKey),
      }),
      group: 'Actions',
      keywords: 'language english chinese i18n locale',
      run: () =>
        context.setLanguage(
          LANGUAGES[(LANGUAGES.indexOf(context.language) + 1) % LANGUAGES.length]
        ),
    }
  );

  // Ticket commands are workspace-scoped: without one, every entry would be a
  // click that goes nowhere, so the group is absent instead of inert.
  if (context.project !== null) {
    const projectId = context.project.projectId;
    for (const issue of issues) {
      commands.push({
        id: `issue:${issue.id}`,
        title: issue.title,
        subtitle: issue.id,
        group: 'Issues',
        keywords: `${issue.id} ${issue.status} ${issue.labels.join(' ')}`,
        run: () => context.navigate(`/w/${projectId}/issue/${issue.id}`),
      });
    }
  }

  return commands;
}

/** Keeps the palette responsive: the caller renders only `limit` results. */
export function rankCommands(
  commands: readonly CommandItem[],
  query: string,
  limit = 50
): CommandItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...commands].slice(0, limit);
  }

  const scored: { command: CommandItem; score: number }[] = [];
  for (const command of commands) {
    const score = scoreCommand(command, needle);
    if (score > 0) {
      scored.push({ command, score });
    }
  }

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, limit).map(({ command }) => command);
}

function scoreCommand(command: CommandItem, needle: string): number {
  const title = command.title.toLowerCase();
  const subtitle = command.subtitle?.toLowerCase() ?? '';
  const keywords = command.keywords?.toLowerCase() ?? '';

  if (title.startsWith(needle)) {
    return 1000 - title.length;
  }
  const wordStart = title.indexOf(needle);
  if (wordStart > 0 && /\W/.test(title[wordStart - 1] ?? '')) {
    return 800 - wordStart;
  }
  if (title.includes(needle)) {
    return 700 - title.indexOf(needle);
  }
  if (subtitle === needle) {
    return 650;
  }
  if (subtitle.includes(needle)) {
    return 500;
  }
  if (keywords.includes(needle)) {
    return 400;
  }

  const fuzzy = fuzzyScore(`${title} ${subtitle} ${keywords}`, needle);
  return fuzzy === null ? 0 : 200 + fuzzy;
}

/** Subsequence match; higher is better (fewer gaps). */
function fuzzyScore(haystack: string, needle: string): number | null {
  let cursor = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) {
      return null;
    }
    gaps += found - cursor;
    cursor = found + 1;
  }
  return Math.max(0, 100 - gaps);
}
