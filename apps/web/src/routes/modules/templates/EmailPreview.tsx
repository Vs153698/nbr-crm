import { renderEmailShell, type EmailDocument } from '@nbr/shared';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/**
 * The email as the recipient will see it.
 *
 * Rendered through the same `renderEmailShell` the API sends with, so this is
 * the message rather than an impression of it. A preview drawn by separate
 * markup would be a promise the send does not have to keep.
 *
 * Isolated in an iframe for two reasons. The document carries its own `<body>`
 * styling and a 600px table layout, which would fight the app's stylesheet if
 * inlined; and `sandbox` with no allowances means the generated HTML cannot run
 * scripts, submit forms or navigate the CRM away — the content is assembled
 * from Admin-written text, and a preview pane is not the place to find out
 * something got through the escaping.
 */
export function EmailPreview({
  document,
  organisationName,
  className,
}: {
  document: EmailDocument;
  organisationName: string;
  className?: string;
}) {
  const html = useMemo(
    () => renderEmailShell(document, organisationName),
    [document, organisationName],
  );

  return (
    <iframe
      // Recreated when the content changes so the iframe re-lays-out rather
      // than keeping the previous document's scroll position.
      key={html.length}
      title="Email preview"
      srcDoc={html}
      sandbox=""
      className={cn('h-full w-full border-0 bg-[#f1f5f9]', className)}
    />
  );
}
