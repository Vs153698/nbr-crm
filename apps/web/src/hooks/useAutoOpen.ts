import { useEffect, useRef } from 'react';

/**
 * Open a tab's dialog on behalf of the Smart Action panel.
 *
 * The panel lives beside the tabs, not inside them, so "Record payment" has to
 * reach a dialog that only the Payment tab owns. Rather than lifting every
 * dialog's state into the profile page — which would put a dozen booleans in
 * one component and couple it to the internals of six others — the page names
 * the action it wants and each tab decides what that means for itself.
 *
 * `onHandled` fires once the dialog is open so the page can clear the request;
 * without that, switching back to the tab later would re-open the dialog.
 *
 * The handler map is read through a ref: it is rebuilt on every render, and
 * depending on it would re-run the effect continuously.
 */
export function useAutoOpen(
  request: string | null | undefined,
  handlers: Record<string, () => void>,
  onHandled?: () => void,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onHandledRef = useRef(onHandled);
  onHandledRef.current = onHandled;

  useEffect(() => {
    if (!request) return;

    const handler = handlersRef.current[request];
    if (!handler) return;

    handler();
    onHandledRef.current?.();
  }, [request]);
}
