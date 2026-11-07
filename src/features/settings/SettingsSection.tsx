import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsSectionProps {
  id: string;
  title?: ReactNode;
  headerAction?: ReactNode;
  header?: ReactNode;
  variant?: 'default' | 'about';
  className?: string;
  children: ReactNode;
}

export function SettingsSection({
  id,
  title,
  headerAction,
  header,
  variant = 'default',
  className,
  children,
}: SettingsSectionProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn(variant === 'about' ? 'space-y-5' : 'space-y-3', className)}
    >
      {header !== undefined ? (
        header
      ) : (
        <div className="flex items-center justify-between">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {headerAction}
        </div>
      )}
      {children}
    </section>
  );
}
