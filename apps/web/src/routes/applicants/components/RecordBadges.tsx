import { PROCESSING_TYPE, processingTypeLabel } from '@nbr/shared';
import { useQuery } from '@tanstack/react-query';
import { Chip } from '@/components/ui/Badge';
import { api } from '@/lib/api-client';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface WebsiteContext {
  mirrored: boolean;
  appCode: string | null;
  externalUrl: string | null;
  awardTitle: string | null;
  awardCategory: string | null;
}

/**
 * What this record *is*, at a glance, beside the applicant's name.
 *
 * Three facts an operator otherwise had to go looking for across two tabs and
 * a second system: whether the entry is one person or a group, which award it
 * was filed for, and the code the website knows it by.
 *
 * The award is the reason this exists. Applications are always *for* something
 * — Bharat Vibhushan and the rest — and until now the CRM showed a record title
 * with no indication of which award it was competing in, which is the first
 * thing anyone reviewing a batch needs to know.
 */
export function RecordBadges({
  recordId,
  recordType,
  processingType,
  adjudicatorRequested,
}: {
  recordId: string;
  recordType: string | null;
  /** DEV-001. Standard or priority — see `PROCESSING_TYPE`. */
  processingType?: string | null;
  /** DEV-002. An adjudicator has to be scheduled for this attempt. */
  adjudicatorRequested?: boolean | null;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.legacyActions(recordId),
    queryFn: ({ signal }) =>
      api.get<WebsiteContext>(`/records/${recordId}/legacy-actions`, undefined, signal),
  });

  const isGroup = recordType === 'group';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recordType ? (
        <Chip tone={isGroup ? 'purple' : 'slate'}>
          {isGroup ? (
            <Icons.Users size={10} strokeWidth={2} />
          ) : (
            <Icons.User size={10} strokeWidth={2} />
          )}
          {isGroup ? 'Group entry' : 'Individual'}
        </Chip>
      ) : null}

      {/*
        DEV-001. Only shown when it is priority.
        Standard is the default and the overwhelming majority, so a chip saying
        so on every record would be noise that buries the one case that changes
        what anyone does — this record is being worked to a 1–3 day promise.
      */}
      {processingType === PROCESSING_TYPE.PRIORITY ? (
        <Chip tone="orange">
          <Icons.Clock size={10} strokeWidth={2} />
          {processingTypeLabel(processingType)}
        </Chip>
      ) : null}

      {/* DEV-002. An operational commitment — someone has to attend — so it is
          worth a badge rather than being buried in the application tab. */}
      {adjudicatorRequested ? (
        <Chip tone="purple">
          <Icons.Users size={10} strokeWidth={2} />
          Adjudicator requested
        </Chip>
      ) : null}

      {data?.awardTitle ? (
        <Chip tone="indigo">
          <Icons.Award size={10} strokeWidth={2} />
          {data.awardTitle}
        </Chip>
      ) : null}

      {data?.awardCategory ? <Chip tone="teal">{data.awardCategory}</Chip> : null}

      {/* The website's own code, so an operator reading a message from that side
          can match it up without opening the other system. */}
      {data?.appCode ? (
        data.externalUrl ? (
          <a
            href={data.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tabular inline-flex items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-2 transition-colors hover:text-brand"
            title="Open this application on the NBR website"
          >
            {data.appCode}
            <Icons.ExternalLink size={9} strokeWidth={ICON_STROKE} />
          </a>
        ) : (
          <span className="tabular rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-2">
            {data.appCode}
          </span>
        )
      ) : null}
    </div>
  );
}
