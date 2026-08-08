import { useQuery } from '@tanstack/react-query';
import {
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE_LABELS,
  type EmployeeStatus,
} from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api-client';
import { formatDate, initials } from '@/lib/format';
import { ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { EmployeeIdPlaque } from './EmployeeIdPlaque';
import { OnboardingDocuments } from './OnboardingDocuments';
import { employeeKeys, type EmployeeDetail } from './types';

/**
 * The employee profile.
 *
 * Laid out the way someone actually reads one: identity and the employee ID
 * first and unmissable, then the facts in themed cards, then the joining file.
 * The previous flat list of label/value rows gave a home address the same
 * visual weight as the ID everyone opens this dialog to find.
 */
export function EmployeeDetailDialog({
  employeeId,
  onClose,
  onEdit,
}: {
  employeeId: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: employeeKeys.detail(employeeId),
    queryFn: ({ signal }) => api.get<EmployeeDetail>(`/employees/${employeeId}`, undefined, signal),
  });

  const meta = data ? EMPLOYEE_STATUS_META[data.status as EmployeeStatus] : undefined;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={data?.fullName ?? 'Employee'}
      description={data ? (data.designation ?? 'No designation recorded') : ''}
      size="xl"
      footer={
        <>
          {onEdit ? (
            <Button variant="secondary" icon={Icons.PenLine} onClick={onEdit}>
              Edit employee
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {isLoading || !data ? (
        <div className="skeleton h-96" />
      ) : (
        <div className="space-y-4">
          {/* Identity band — who this is, and the number everyone came for. */}
          <header className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-canvas p-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-navy text-sm font-bold text-white">
              {initials(data.fullName)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold text-ink">{data.fullName}</h3>
                <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? data.status}</Chip>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-3">
                {[
                  data.designation,
                  data.department,
                  EMPLOYMENT_TYPE_LABELS[
                    data.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS
                  ],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            <EmployeeIdPlaque employeeCode={data.employeeCode} />
          </header>

          {/* At-a-glance facts, so the common questions need no scanning. */}
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat icon={Icons.Phone} label="Mobile" value={data.mobile} mono />
            <Stat
              icon={Icons.CalendarClock}
              label="Joined"
              value={data.joinedOn ? formatDate(data.joinedOn) : '—'}
            />
            <Stat icon={Icons.Building2} label="Location" value={data.workLocation ?? '—'} />
            <Stat
              icon={Icons.FileText}
              label="Documents"
              value={`${data.documentCount} on file`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Employment" icon={Icons.Briefcase} />
              <dl>
                <Row label="Department" value={data.department} />
                <Row label="Designation" value={data.designation} />
                <Row
                  label="Type"
                  value={
                    EMPLOYMENT_TYPE_LABELS[
                      data.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS
                    ]
                  }
                />
                <Row label="Joined" value={data.joinedOn ? formatDate(data.joinedOn) : null} />
                <Row label="Exited" value={data.exitedOn ? formatDate(data.exitedOn) : null} />
                <Row label="Reports to" value={data.reportsToName} />
                <Row label="Login account" value={data.userId ? 'Linked' : 'None'} />
              </dl>
            </Card>

            <Card>
              <CardHeader title="Contact" icon={Icons.Phone} />
              <dl>
                <Row label="Mobile" value={data.mobile} mono />
                <Row label="Alternate" value={data.alternatePhone} mono />
                <Row label="Work email" value={data.workEmail} />
                <Row label="Personal email" value={data.personalEmail} />
                <Row
                  label="Address"
                  value={[data.addressLine, data.city, data.state, data.pincode]
                    .filter(Boolean)
                    .join(', ')}
                />
                <Row
                  label="Date of birth"
                  value={data.dateOfBirth ? formatDate(data.dateOfBirth) : null}
                />
              </dl>
            </Card>

            <Card>
              <CardHeader title="Emergency contact" icon={Icons.AlertCircle} />
              <dl>
                <Row label="Name" value={data.emergencyContactName} />
                <Row label="Phone" value={data.emergencyContactPhone} mono />
                <Row label="Relationship" value={data.emergencyContactRelation} />
              </dl>
            </Card>

            <Card>
              <CardHeader title={`Direct reports (${data.reports.length})`} icon={Icons.Users} />
              {data.reports.length === 0 ? (
                <p className="py-3 text-xs text-ink-3">Nobody reports to this person.</p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {data.reports.map((person) => (
                    <li key={person.id} className="py-1.5 text-xs text-ink-2">
                      {person.fullName}
                      {person.designation ? (
                        <span className="text-ink-3"> — {person.designation}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Onboarding documents"
              subtitle="The joining file — letters, ID proofs, certificates and the signed contract."
              icon={Icons.FilePlus2}
              action={
                data.documentCount > 0 ? (
                  <Chip tone="slate">
                    {data.documentCount} file{data.documentCount === 1 ? '' : 's'}
                  </Chip>
                ) : null
              }
            />
            <div className="mt-3">
              <OnboardingDocuments employeeId={employeeId} />
            </div>
          </Card>

          {data.notes ? (
            <Card>
              <CardHeader title="Notes" icon={Icons.StickyNote} />
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{data.notes}</p>
            </Card>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-card border border-line bg-white px-3 py-2">
      <Icon size={16} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-4" aria-hidden />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
        <p className={`truncate text-xs font-semibold text-ink ${mono ? 'tabular' : ''}`}>{value}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/60 py-1.5 text-xs last:border-0">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className={`text-right font-medium text-ink ${mono ? 'tabular' : ''}`}>{value || '—'}</dd>
    </div>
  );
}
