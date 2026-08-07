import {
  TEMPLATE_CHANNEL,
  TEMPLATE_CODE_PATTERN,
  TEMPLATE_VARIABLES,
  editableStrings,
  validateTemplate,
  type EmailBlock,
  type EmailDocument,
} from '@nbr/shared';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import { humanise } from '@/lib/format';
import { Icons } from '@/lib/icons';
import { AddBlockRow, BlockEditor } from './BlockEditor';
import { EmailPreview } from './EmailPreview';
import { SAMPLE_CONTEXT, fillDocument } from './sample-context';

export interface TemplateRow {
  id: string;
  code: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  document: EmailDocument | null;
  isActive: boolean;
  updatedAt: string;
  /** Built-in templates back workflow stages and cannot be deleted. */
  isSystem: boolean;
}

/** What a brand-new email template starts from, so it matches the others. */
const STARTER_DOCUMENT: EmailDocument = {
  heading: 'A message from the National Book of Records',
  subheading: '',
  blocks: [{ type: 'paragraph', text: 'Dear {{applicant_name}},' }],
  signoff: 'Warm regards,',
};

/**
 * Create or edit one template.
 *
 * `template` is null when creating. A new one needs a code and a name as well,
 * because those identify it — for an existing template both are fixed: the code
 * is what the workflow and the API address it by, and changing it in place
 * would silently create a second template rather than rename this one.
 *
 * Email templates are edited as areas beside a live preview of the real thing.
 * Nobody is shown HTML: the layout belongs to the brand, and the words belong
 * to the Admin.
 */
export function TemplateEditor({
  template,
  channel,
  organisationName,
  onClose,
  onSaved,
}: {
  template: TemplateRow | null;
  channel: string;
  organisationName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = template === null;
  const activeChannel = isNew ? channel : template.channel;
  const isEmail = activeChannel === TEMPLATE_CHANNEL.EMAIL;

  const [code, setCode] = useState(template?.code ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [isActive, setIsActive] = useState(template?.isActive ?? true);

  // WhatsApp has no HTML, so it keeps the plain-text box it always had.
  const [body, setBody] = useState(template?.body ?? '');
  const [document, setDocument] = useState<EmailDocument>(
    template?.document ?? STARTER_DOCUMENT,
  );

  const codeIsValid = TEMPLATE_CODE_PATTERN.test(code);

  // The same validator the API runs, so an unknown field shows up while the
  // Admin is still looking at the box that caused it.
  const unknown = useMemo(() => {
    const sources = isEmail ? editableStrings(document) : [body];
    const found = new Set<string>();

    for (const text of [...sources, subject]) {
      for (const name of validateTemplate(text).unknown) found.add(name);
    }

    return [...found];
  }, [isEmail, document, body, subject]);

  /** The preview is filled with example data — a template has no applicant. */
  const previewDocument = useMemo(() => fillDocument(document), [document]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put('/templates', {
        code: isNew ? code : template.code,
        channel: activeChannel,
        name: isNew ? name : template.name,
        subject: subject || undefined,
        body: isEmail ? undefined : body,
        document: isEmail ? document : undefined,
        isActive,
      }),
    onSuccess: () => {
      toast.success(isNew ? 'Template created' : 'Template saved');
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the template'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/templates/${template!.id}`),
    onSuccess: () => {
      toast.success('Template deleted');
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the template'),
  });

  function updateBlock(index: number, next: EmailBlock) {
    setDocument((current) => ({
      ...current,
      blocks: current.blocks.map((block, i) => (i === index ? next : block)),
    }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDocument((current) => {
      const blocks = [...current.blocks];
      const target = index + direction;
      [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
      return { ...current, blocks };
    });
  }

  const hasContent = isEmail ? document.blocks.length > 0 && document.heading.trim() : body.trim();

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={isNew ? 'New template' : `Edit — ${template.name}`}
      description={`${humanise(activeChannel)} template`}
      size={isEmail ? 'xl' : 'lg'}
      footer={
        <>
          {/* Only custom templates can go: a built-in backs a workflow stage,
              and deleting it would leave that stage with nothing to send. */}
          {!isNew && !template.isSystem ? (
            <Button
              variant="danger"
              icon={Icons.Trash2}
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              className="mr-auto"
            >
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveMutation.isPending}
            disabled={
              unknown.length > 0 || !hasContent || (isNew && (!codeIsValid || !name.trim()))
            }
            onClick={() => saveMutation.mutate()}
          >
            {isNew ? 'Create template' : 'Save template'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {unknown.length > 0 ? (
          <div className="flex gap-2 rounded-lg border border-danger-ring bg-danger-tint p-2.5">
            <Icons.XCircle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[11px] leading-relaxed text-danger">
              Unknown field{unknown.length === 1 ? '' : 's'}:{' '}
              <b>{unknown.map((field) => `{{${field}}}`).join(', ')}</b>. These would render as
              blank text, so the template cannot be saved until they're corrected.
            </p>
          </div>
        ) : null}

        {isNew ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Anniversary greeting"
            />
            <Input
              label="Code"
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
              }
              placeholder="anniversary_greeting"
              hint="How the API and the workflow refer to this template. It cannot be changed later."
              error={
                code && !codeIsValid
                  ? 'Start with a letter; lowercase letters, numbers and underscores only.'
                  : undefined
              }
            />
          </div>
        ) : null}

        {isEmail ? (
          <>
            <Input
              label="Subject line"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Your certificate {{certificate_no}} is ready"
            />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="rounded-lg border border-line bg-canvas p-3">
                  <p className="mb-2 text-xs font-semibold text-ink-2">Header</p>
                  <div className="space-y-2.5">
                    <Input
                      label="Headline"
                      value={document.heading}
                      onChange={(event) =>
                        setDocument((current) => ({ ...current, heading: event.target.value }))
                      }
                      placeholder="Your record has been approved!"
                    />
                    <Input
                      label="Strapline"
                      value={document.subheading ?? ''}
                      onChange={(event) =>
                        setDocument((current) => ({ ...current, subheading: event.target.value }))
                      }
                      hint="Optional — the small line under the headline."
                    />
                  </div>
                </div>

                <ul className="space-y-2">
                  {document.blocks.map((block, index) => (
                    <BlockEditor
                      key={index}
                      block={block}
                      index={index}
                      total={document.blocks.length}
                      onChange={(next) => updateBlock(index, next)}
                      onMove={(direction) => moveBlock(index, direction)}
                      onRemove={() =>
                        setDocument((current) => ({
                          ...current,
                          blocks: current.blocks.filter((_, i) => i !== index),
                        }))
                      }
                    />
                  ))}
                </ul>

                {document.blocks.length < 20 ? (
                  <AddBlockRow
                    onAdd={(block) =>
                      setDocument((current) => ({ ...current, blocks: [...current.blocks, block] }))
                    }
                  />
                ) : null}

                <Input
                  label="Sign-off"
                  value={document.signoff ?? ''}
                  onChange={(event) =>
                    setDocument((current) => ({ ...current, signoff: event.target.value }))
                  }
                  hint="The organisation's name is added under this automatically."
                />

                <FieldPalette />
              </div>

              {/* Sticky so the preview stays in view while a long message is
                  edited — checking your wording should not need scrolling back. */}
              <div className="lg:sticky lg:top-0 lg:self-start">
                <p className="mb-1.5 text-xs font-semibold text-ink-2">
                  What the applicant receives
                </p>
                <div className="h-[560px] overflow-hidden rounded-lg border border-line">
                  <EmailPreview document={previewDocument} organisationName={organisationName} />
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
                  Shown with example details. The real message uses the applicant's own.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <Textarea
              label="Message"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={12}
              hint="WhatsApp messages are plain text — no formatting is applied."
            />
            <FieldPalette />
          </>
        )}

        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-line text-brand"
          />
          Active — available in the send dialogs
        </label>
      </div>
    </Dialog>
  );
}

/**
 * The fields a message can carry.
 *
 * Reference rather than an insert button: with many separate areas there is no
 * single cursor to insert into, so this lists what may be typed and what each
 * one means. Clicking copies it, which is the part that actually saves typing.
 */
function FieldPalette() {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-ink-2">
        Fields you can use — type them anywhere, or click to copy
      </p>
      <div className="scrollbar-slim flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {Object.entries(TEMPLATE_VARIABLES).map(([field, description]) => (
          <button
            key={field}
            type="button"
            title={description}
            onClick={() => {
              void navigator.clipboard?.writeText(`{{${field}}}`);
              toast.success(`{{${field}}} copied`);
            }}
            className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-brand hover:text-brand"
          >
            {field}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-ink-3">
        Each is replaced with the applicant's real details when the message is sent.
      </p>
    </div>
  );
}

export { SAMPLE_CONTEXT };
