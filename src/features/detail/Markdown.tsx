import { memo, useMemo, type ComponentProps, type MouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { isExternalUrl, openExternal } from '@/lib/links';

export type MarkdownProps = {
  children: string;
  className?: string;
  /** Injected by tests; production opens through the OS browser. */
  onOpenLink?: (url: string) => void;
};

// Stable identities: react-markdown rebuilds its processor when these arrays
// change, and re-parsing a long body on an unrelated re-render is expensive.
const REMARK_PLUGINS: NonNullable<ComponentProps<typeof ReactMarkdown>['remarkPlugins']> = [
  remarkGfm,
];
const REHYPE_PLUGINS: NonNullable<ComponentProps<typeof ReactMarkdown>['rehypePlugins']> = [
  [rehypeSanitize, defaultSchema],
];

/**
 * The single Markdown renderer for issue content. Raw HTML is never parsed
 * (no rehype-raw) and the sanitize schema is applied once here, so a new
 * surface cannot quietly ship a weaker pipeline.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
  onOpenLink = openExternal,
}: MarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children: label }) {
        if (!isExternalUrl(href)) {
          // Relative links have no destination inside a desktop app; rendering
          // text instead of an anchor also blocks in-app navigation.
          return <span>{label}</span>;
        }
        return (
          <a
            href={href}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              onOpenLink(href);
            }}
          >
            {label}
          </a>
        );
      },
      img({ src, alt }) {
        // Remote images are never fetched: no <img> element reaches the DOM.
        // The address stays available as a link the user can open deliberately.
        const address = typeof src === 'string' ? src : '';
        const label = alt === undefined || alt === '' ? 'Image' : `Image: ${alt}`;
        return (
          <span className="inline-flex max-w-full items-baseline gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            <span>{label}</span>
            {address === '' ? null : isExternalUrl(address) ? (
              <a
                href={address}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  onOpenLink(address);
                }}
                className="truncate font-mono"
              >
                {address}
              </a>
            ) : (
              <span className="truncate font-mono">{address}</span>
            )}
          </span>
        );
      },
    }),
    [onOpenLink]
  );

  return (
    <div className={className === undefined ? 'markdown-body' : `markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
