import {
  WHATSAPP_PARAM_SOURCE,
  WHATSAPP_PARAM_SOURCE_LABELS,
  WHATSAPP_TEMPLATE_CODES,
  type WhatsAppTemplate,
  type WhatsAppTemplateParam,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';

/**
 * The WhatsApp template registry editor.
 *
 * An operator registers each template they have already had approved in
 * AiSensy: the campaign name it sends under, a name their own team will
 * recognise, and — in order — the values its `{{1}}`, `{{2}}` … placeholders
 * expect.
 *
 * That order is the part worth being careful about. It is invisible on the
 * wire (the provider takes a bare array) and getting it wrong does not fail —
 * it delivers a real message with the tracking number where the date should be.
 * So each row is numbered with the placeholder it fills rather than leaving the
 * correspondence implied, and moving a row renumbers the rest.
 */

const SOURCE_OPTIONS = Object.values(WHATSAPP_PARAM_SOURCE).map((value) => ({
  value,
  label: WHATSAPP_PARAM_SOURCE_LABELS[value],
}));

interface Props {
  templates: readonly WhatsAppTemplate[];
  disabled?: boolean;
  onChange: (next: WhatsAppTemplate[]) => void;
}

/**
 * A row identifier, unique for the life of the page.
 *
 * The counter matters: two rows added inside the same millisecond would
 * otherwise share a timestamp, and duplicate ids are the whole bug this
 * replaced.
 */
let idCounter = 0;
function newTemplateId(): string {
  idCounter += 1;
  return `template-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Guarantee every row has an id of its own before the change leaves the editor.
 *
 * Ids used to be derived from the friendly name, and only on its first
 * keystroke — so a row's permanent id was the slug of a single character, and
 * any two templates whose names began with the same letter shared one. Every
 * edit then hit both rows, and Remove deleted both.
 *
 * Repairing on the way out means opening this screen and touching anything
 * fixes a registry already saved in that state. Reassigning is safe: nothing
 * outside the registry stores a template id — automatic sends bind through
 * `templateCode`, and the test send picks from the live list.
 */
function withUniqueIds(templates: readonly WhatsAppTemplate[]): WhatsAppTemplate[] {
  const seen = new Set<string>();
  return templates.map((template) => {
    if (template.id && !seen.has(template.id)) {
      seen.add(template.id);
      return template;
    }
    let candidate = newTemplateId();
    while (seen.has(candidate)) candidate = newTemplateId();
    seen.add(candidate);
    return { ...template, id: candidate };
  });
}

export function WhatsAppTemplatesEditor({ templates, disabled, onChange }: Props) {
  /** Every change leaves through here, so ids are repaired on the way out. */
  function emit(next: readonly WhatsAppTemplate[]): void {
    onChange(withUniqueIds(next));
  }

  /**
   * Rows are addressed by position rather than by id throughout.
   *
   * A row is only ever edited from its own controls, so its index is exactly
   * the right handle — and unlike an id it cannot be shared with another row,
   * so a registry already saved with duplicate ids still edits correctly.
   */
  function updateTemplate(index: number, patch: Partial<WhatsAppTemplate>) {
    emit(templates.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function updateParam(templateIndex: number, index: number, patch: Partial<WhatsAppTemplateParam>) {
    emit(
      templates.map((t, i) =>
        i === templateIndex
          ? { ...t, params: t.params.map((p, j) => (j === index ? { ...p, ...patch } : p)) }
          : t,
      ),
    );
  }

  function moveParam(templateIndex: number, index: number, delta: number) {
    emit(
      templates.map((t, i) => {
        if (i !== templateIndex) return t;
        const target = index + delta;
        if (target < 0 || target >= t.params.length) return t;
        const params = [...t.params];
        const [moved] = params.splice(index, 1);
        params.splice(target, 0, moved!);
        return { ...t, params };
      }),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs leading-relaxed text-ink-3">
          Register each template approved in AiSensy. The campaign name must match theirs exactly;
          the friendly name is what your team picks from when sending. Values fill the placeholders
          in the order listed.
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={Icons.Plus}
          disabled={disabled}
          onClick={() =>
            emit([
              ...templates,
              {
                id: newTemplateId(),
                label: '',
                campaignName: '',
                params: [],
                templateCode: null,
                isActive: true,
              },
            ])
          }
        >
          Add template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6 text-center">
          <Icons.MessageCircle size={22} strokeWidth={ICON_STROKE} className="mx-auto mb-2 text-ink-4" />
          <p className="text-xs text-ink-2">No templates registered yet.</p>
          <p className="mt-0.5 text-2xs text-ink-3">
            Add one for each approved template you want to send from here.
          </p>
        </div>
      ) : null}

      {templates.map((template, templateIndex) => (
        <div
          key={templateIndex}
          className="space-y-3 rounded-xl border border-line bg-canvas/60 p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Friendly name"
              placeholder="e.g. Selection letter"
              value={template.label}
              disabled={disabled}
              onChange={(event) => updateTemplate(templateIndex, { label: event.target.value })}
            />
            <Input
              label="AiSensy campaign name"
              placeholder="e.g. nbr_selection_v3"
              value={template.campaignName}
              disabled={disabled}
              onChange={(event) => updateTemplate(templateIndex, { campaignName: event.target.value })}
            />
            <Select
              label="Answers template"
              hint="Lets an existing send path pick this automatically."
              value={template.templateCode ?? ''}
              disabled={disabled}
              onChange={(event) =>
                updateTemplate(templateIndex, { templateCode: event.target.value || null })
              }
              options={[
                { value: '', label: '— Manual sends only —' },
                ...WHATSAPP_TEMPLATE_CODES.map((code) => ({ value: code, label: humanise(code) })),
              ]}
            />
            <div className="flex items-end justify-between gap-2 pb-1">
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={template.isActive}
                  disabled={disabled}
                  onChange={(event) =>
                    updateTemplate(templateIndex, { isActive: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                />
                Active
              </label>
              <Button
                size="sm"
                variant="ghost"
                icon={Icons.Trash2}
                disabled={disabled}
                onClick={() => emit(templates.filter((_, i) => i !== templateIndex))}
              >
                Remove
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
                Values, in order
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  updateTemplate(templateIndex, {
                    params: [
                      ...template.params,
                      {
                        key: `param${template.params.length + 1}`,
                        label: '',
                        source: WHATSAPP_PARAM_SOURCE.MANUAL,
                      },
                    ],
                  })
                }
                className="text-2xs font-semibold text-brand transition-colors hover:text-brand/80 disabled:opacity-40"
              >
                + Add value
              </button>
            </div>

            {template.params.length === 0 ? (
              <p className="py-1 text-2xs text-ink-3">
                No values — for a template with no placeholders.
              </p>
            ) : null}

            <div className="space-y-2">
              {template.params.map((param, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="tabular flex h-7 w-10 shrink-0 items-center justify-center rounded-lg bg-navy text-[10px] font-bold text-white">
                    {`{{${index + 1}}}`}
                  </span>
                  <input
                    value={param.label}
                    disabled={disabled}
                    placeholder="What is this? e.g. Applicant name"
                    onChange={(event) =>
                      updateParam(templateIndex, index, { label: event.target.value })
                    }
                    className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 text-xs text-ink outline-none transition-colors focus:border-brand"
                  />
                  <select
                    value={param.source}
                    disabled={disabled}
                    onChange={(event) =>
                      updateParam(templateIndex, index, {
                        source: event.target.value as WhatsAppTemplateParam['source'],
                        // The key doubles as the form field name on a manual
                        // send; aligning it to the source is what lets an
                        // automatic value fill in with no extra mapping.
                        key:
                          event.target.value === WHATSAPP_PARAM_SOURCE.MANUAL
                            ? param.key
                            : event.target.value,
                      })
                    }
                    className="h-9 w-48 shrink-0 rounded-lg border border-line bg-white px-2 text-xs text-ink outline-none transition-colors focus:border-brand"
                  >
                    {SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex shrink-0 flex-col leading-none">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={disabled || index === 0}
                      onClick={() => moveParam(templateIndex, index, -1)}
                      className={cn('px-1 text-[9px] text-ink-3 hover:text-ink', 'disabled:opacity-30')}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={disabled || index === template.params.length - 1}
                      onClick={() => moveParam(templateIndex, index, 1)}
                      className={cn('px-1 text-[9px] text-ink-3 hover:text-ink', 'disabled:opacity-30')}
                    >
                      ▼
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove value"
                    disabled={disabled}
                    onClick={() =>
                      updateTemplate(templateIndex, {
                        params: template.params.filter((_, i) => i !== index),
                      })
                    }
                    className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-danger-tint hover:text-danger disabled:opacity-40"
                  >
                    <Icons.Trash2 size={13} strokeWidth={ICON_STROKE} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
