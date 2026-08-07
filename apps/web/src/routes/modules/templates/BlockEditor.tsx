import {
  blankEmailBlock,
  EMAIL_BLOCK_META,
  EMAIL_BLOCK_TYPES,
  type EmailBlock,
  type EmailBlockType,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * Editing one area of an email.
 *
 * Every control here edits words, never markup. That is the whole point: an
 * Admin should be able to reword a message without knowing what a `<table>` is,
 * and the layout should stay on-brand because it was never theirs to change.
 */
export function BlockEditor({
  block,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  block: EmailBlock;
  index: number;
  total: number;
  onChange: (next: EmailBlock) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const meta = EMAIL_BLOCK_META[block.type];

  return (
    <li className="rounded-lg border border-line bg-white">
      <header className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-brand-tint text-[10px] font-bold text-brand">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-ink">{meta.label}</p>
        </div>

        <button
          type="button"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="grid h-6 w-6 place-items-center rounded text-ink-3 transition-colors hover:bg-slate2-tint hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Icons.ChevronUp size={14} strokeWidth={ICON_STROKE} />
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          className="grid h-6 w-6 place-items-center rounded text-ink-3 transition-colors hover:bg-slate2-tint hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Icons.ChevronDown size={14} strokeWidth={ICON_STROKE} />
        </button>
        <button
          type="button"
          aria-label={`Remove ${meta.label.toLowerCase()}`}
          onClick={onRemove}
          className="grid h-6 w-6 place-items-center rounded text-ink-3 transition-colors hover:bg-danger-tint hover:text-danger"
        >
          <Icons.Trash2 size={14} strokeWidth={ICON_STROKE} />
        </button>
      </header>

      <div className="space-y-2.5 p-3">
        <Fields block={block} onChange={onChange} />
      </div>
    </li>
  );
}

function Fields({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (next: EmailBlock) => void;
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <Textarea
          label="Text"
          value={block.text}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
          rows={4}
          placeholder="Dear {{applicant_name}},"
        />
      );

    case 'note':
      return (
        <Textarea
          label="Text"
          value={block.text}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
          rows={3}
          hint="Shown quieter than a paragraph, with an orange edge. Good for support details."
        />
      );

    case 'highlight':
      return (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Input
              label="Label"
              value={block.label}
              onChange={(event) => onChange({ ...block, label: event.target.value })}
              placeholder="Your Application ID"
            />
            <Input
              label="Value"
              value={block.value}
              onChange={(event) => onChange({ ...block, value: event.target.value })}
              placeholder="{{applicant_id}}"
            />
          </div>
          <Input
            label="Caption"
            value={block.caption ?? ''}
            onChange={(event) => onChange({ ...block, caption: event.target.value })}
            hint="Optional line under the value."
          />
        </>
      );

    case 'details':
      return (
        <>
          <Input
            label="Title"
            value={block.title ?? ''}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
            placeholder="Application details"
          />

          <div className="space-y-2">
            {block.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex items-end gap-2">
                <Input
                  containerClassName="w-2/5"
                  label={rowIndex === 0 ? 'Label' : undefined}
                  value={row.label}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      rows: block.rows.map((r, i) =>
                        i === rowIndex ? { ...r, label: event.target.value } : r,
                      ),
                    })
                  }
                  placeholder="Category"
                />
                <Input
                  containerClassName="flex-1"
                  label={rowIndex === 0 ? 'Value' : undefined}
                  value={row.value}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      rows: block.rows.map((r, i) =>
                        i === rowIndex ? { ...r, value: event.target.value } : r,
                      ),
                    })
                  }
                  placeholder="{{category}}"
                />
                <button
                  type="button"
                  aria-label="Remove row"
                  disabled={block.rows.length === 1}
                  onClick={() =>
                    onChange({ ...block, rows: block.rows.filter((_, i) => i !== rowIndex) })
                  }
                  className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-danger-tint hover:text-danger disabled:opacity-30"
                >
                  <Icons.X size={14} strokeWidth={ICON_STROKE} />
                </button>
              </div>
            ))}
          </div>

          <Button
            size="sm"
            variant="ghost"
            icon={Icons.Plus}
            disabled={block.rows.length >= 12}
            onClick={() => onChange({ ...block, rows: [...block.rows, { label: '', value: '' }] })}
          >
            Add row
          </Button>
        </>
      );

    case 'steps':
      return (
        <>
          <Input
            label="Title"
            value={block.title}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
            placeholder="What happens next?"
          />

          <div className="space-y-2.5">
            {block.items.map((item, itemIndex) => (
              <div key={itemIndex} className="rounded border border-line p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                    Step {itemIndex + 1}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove step"
                    disabled={block.items.length === 1}
                    onClick={() =>
                      onChange({ ...block, items: block.items.filter((_, i) => i !== itemIndex) })
                    }
                    className="grid h-6 w-6 place-items-center rounded text-ink-3 transition-colors hover:bg-danger-tint hover:text-danger disabled:opacity-30"
                  >
                    <Icons.X size={13} strokeWidth={ICON_STROKE} />
                  </button>
                </div>

                <div className="space-y-2">
                  <Input
                    value={item.title}
                    onChange={(event) =>
                      onChange({
                        ...block,
                        items: block.items.map((s, i) =>
                          i === itemIndex ? { ...s, title: event.target.value } : s,
                        ),
                      })
                    }
                    placeholder="Expert review"
                  />
                  <Textarea
                    rows={2}
                    value={item.text}
                    onChange={(event) =>
                      onChange({
                        ...block,
                        items: block.items.map((s, i) =>
                          i === itemIndex ? { ...s, text: event.target.value } : s,
                        ),
                      })
                    }
                    placeholder="Our team will verify your achievement."
                  />
                </div>
              </div>
            ))}
          </div>

          <Button
            size="sm"
            variant="ghost"
            icon={Icons.Plus}
            disabled={block.items.length >= 6}
            onClick={() => onChange({ ...block, items: [...block.items, { title: '', text: '' }] })}
          >
            Add step
          </Button>
        </>
      );

    case 'button':
      return (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Input
            label="Button text"
            value={block.label}
            onChange={(event) => onChange({ ...block, label: event.target.value })}
            placeholder="Track your delivery"
          />
          <Input
            label="Links to"
            value={block.url}
            onChange={(event) => onChange({ ...block, url: event.target.value })}
            placeholder="https://…"
            hint="Must start with https:// — or be a field like {{tracking_url}}."
            error={
              block.url && !/^(https?:\/\/|\{\{)/i.test(block.url.trim())
                ? 'Links must start with http:// or https://'
                : undefined
            }
          />
        </div>
      );
  }
}

/** The palette of areas that can be added to a message. */
export function AddBlockRow({ onAdd }: { onAdd: (block: EmailBlock) => void }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-3">
      <p className="mb-2 text-xs font-semibold text-ink-2">Add an area</p>
      <div className="flex flex-wrap gap-1.5">
        {EMAIL_BLOCK_TYPES.map((type: EmailBlockType) => (
          <button
            key={type}
            type="button"
            title={EMAIL_BLOCK_META[type].hint}
            onClick={() => onAdd(blankEmailBlock(type))}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand hover:bg-brand-tint/40 hover:text-brand"
          >
            <Icons.Plus size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
            {EMAIL_BLOCK_META[type].label}
          </button>
        ))}
      </div>
    </div>
  );
}
