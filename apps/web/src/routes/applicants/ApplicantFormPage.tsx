import {
  APPLICATION_SOURCE,
  APPLICATION_SOURCE_LABELS,
  CONSENT_ARTEFACT,
  CONSENT_CHANNEL,
  GENDER,
  PROCESSING_PURPOSE,
  PURPOSE_META,
  RECORD_STATUS,
  RECORD_TYPE,
  ageInYears,
  CHILD_AGE_THRESHOLD_YEARS,
  CONSENT_NOTICE_VERSION,
  type DuplicateMatch,
} from '@nbr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import { useDebounce } from '@/hooks/useDebounce';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import type { Lookups } from './types';

interface CreateResult {
  applicantId: string;
  applicantCode: string;
  recordId: string;
  recordCode: string;
}

const ESSENTIAL_PURPOSES = Object.values(PROCESSING_PURPOSE).filter(
  (purpose) => PURPOSE_META[purpose].essential,
);
const OPTIONAL_PURPOSES = Object.values(PROCESSING_PURPOSE).filter(
  (purpose) => !PURPOSE_META[purpose].essential,
);

/**
 * W-05 Add Applicant (§3, §18).
 *
 * Three things happen here that matter:
 *  • Duplicate detection runs live as the user types, before they've filled in
 *    the rest of the form — finding the existing profile at field three saves
 *    re-typing the other twenty.
 *  • DPDP consent is captured at intake, not bolted on later. Essential
 *    purposes are required; publicity and dispatch are genuinely optional.
 *  • A minor cannot be saved without a named guardian, matching the API guard.
 */
export default function ApplicantFormPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: '',
    fatherName: '',
    motherName: '',
    dateOfBirth: '',
    gender: '',
    mobile: '',
    whatsapp: '',
    email: '',
    addressLine: '',
    city: '',
    state: '',
    country: 'India',
    pincode: '',
    nationality: 'Indian',
    aadhaarNumber: '',
    recordTitle: '',
    categoryId: '',
    recordType: RECORD_TYPE.INDIVIDUAL as string,
    achievementDate: '',
    location: '',
    participantCount: '1',
    description: '',
    source: APPLICATION_SOURCE.WALK_IN as string,
    assignedToUserId: '',
    initialStatus: RECORD_STATUS.NEW_LEAD as string,
    internalRemarks: '',
  });

  const [consentPurposes, setConsentPurposes] = useState<string[]>([...ESSENTIAL_PURPOSES]);
  const [consentChannel, setConsentChannel] = useState<string>(CONSENT_CHANNEL.STAFF_ENTERED);
  const [guardianName, setGuardianName] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState('');
  const [guardianContact, setGuardianContact] = useState('');
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
  });

  // ── Live duplicate detection (§18) ────────────────────────────────────────
  const duplicateProbe = useDebounce(
    { mobile: form.mobile, email: form.email, fullName: form.fullName, dateOfBirth: form.dateOfBirth },
    400,
  );

  const probeReady =
    duplicateProbe.mobile.replace(/\D/g, '').length >= 10 ||
    duplicateProbe.email.includes('@') ||
    duplicateProbe.fullName.trim().length >= 3;

  const { data: duplicates } = useQuery({
    queryKey: ['duplicate-check', duplicateProbe],
    queryFn: () =>
      api.post<{ matches: DuplicateMatch[]; blocking: boolean }>('/applicants/check-duplicate', {
        mobile: duplicateProbe.mobile || undefined,
        email: duplicateProbe.email || undefined,
        fullName: duplicateProbe.fullName || undefined,
        dateOfBirth: duplicateProbe.dateOfBirth || undefined,
      }),
    enabled: probeReady,
    staleTime: 15_000,
  });

  const isMinor = useMemo(() => {
    if (!form.dateOfBirth) return false;
    const age = ageInYears(form.dateOfBirth);
    return Number.isFinite(age) && age < CHILD_AGE_THRESHOLD_YEARS;
  }, [form.dateOfBirth]);

  // A minor's consent is legally the guardian's, so the channel changes too.
  useEffect(() => {
    if (isMinor && !consentPurposes.includes(PROCESSING_PURPOSE.RECORD_APPLICATION)) {
      setConsentPurposes((previous) => [...previous, PROCESSING_PURPOSE.RECORD_APPLICATION]);
    }
  }, [isMinor, consentPurposes]);

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post<CreateResult>('/applicants', payload),
    onSuccess: (result) => {
      toast.success(`${result.applicantCode} created`, {
        description: `Record ${result.recordCode} opened.`,
      });
      navigate(`/applicants/${result.applicantId}`, { replace: true });
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) {
        toast.error('Could not save. Please try again.');
        return;
      }

      if (error.code === 'DUPLICATE_APPLICANT') {
        toast.warning('Possible existing applicant', {
          description: 'Review the matches above, then confirm to continue.',
        });
        return;
      }
      if (error.code === 'BLACKLIST_BLOCKED') {
        toast.error('Blacklisted applicant', { description: error.message });
        return;
      }

      const fieldErrors: Record<string, string> = {};
      for (const { name, message } of error.fieldErrors) {
        // Server paths are dotted (`applicant.mobile`); the form is flat.
        fieldErrors[name.split('.').pop() ?? name] = message;
      }
      setErrors(fieldErrors);
      toast.error(error.message);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const localErrors: Record<string, string> = {};
    if (!form.fullName.trim()) localErrors.fullName = 'Enter the applicant’s full name';
    if (!form.mobile.trim()) localErrors.mobile = 'Enter a mobile number';
    if (!form.email.trim()) localErrors.email = 'Enter an email address';
    if (!form.recordTitle.trim()) localErrors.recordTitle = 'Enter the record title';
    if (!form.categoryId) localErrors.categoryId = 'Choose a category';
    if (isMinor && !guardianName.trim()) {
      localErrors.guardianName = 'A parent or guardian must be named for an applicant under 18';
    }

    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      toast.error('Please correct the highlighted fields');
      return;
    }

    createMutation.mutate({
      applicant: {
        fullName: form.fullName,
        fatherName: form.fatherName || undefined,
        motherName: form.motherName || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        mobile: form.mobile,
        whatsapp: form.whatsapp || undefined,
        email: form.email,
        addressLine: form.addressLine || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        country: form.country,
        pincode: form.pincode || undefined,
        nationality: form.nationality || undefined,
      },
      identifiers: form.aadhaarNumber ? { aadhaarNumber: form.aadhaarNumber } : undefined,
      record: {
        source: form.source,
        assignedToUserId: form.assignedToUserId || undefined,
        initialStatus: form.initialStatus,
        internalRemarks: form.internalRemarks || undefined,
        achievement: {
          recordTitle: form.recordTitle,
          categoryId: form.categoryId,
          recordType: form.recordType,
          description: form.description || undefined,
          achievementDate: form.achievementDate || undefined,
          location: form.location || undefined,
          participantCount: Number(form.participantCount) || 1,
        },
      },
      consent: {
        purposes: consentPurposes,
        artefacts: [CONSENT_ARTEFACT.TERMS_AND_CONDITIONS, CONSENT_ARTEFACT.PRIVACY_NOTICE],
        channel: consentChannel,
        noticeVersion: CONSENT_NOTICE_VERSION,
        guardianName: guardianName || undefined,
        guardianRelationship: guardianRelationship || undefined,
        guardianContact: guardianContact || undefined,
      },
      overrideDuplicate,
      overrideReason: overrideReason || undefined,
    });
  }

  const blockingDuplicate = duplicates?.blocking ?? false;
  const blacklistedMatch = duplicates?.matches.find((match) => match.isBlacklisted);

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Add applicant"
        subtitle="Creates the master profile and its first record in one step."
        back={{ to: '/applicants', label: 'Applicants' }}
      />

      <form onSubmit={handleSubmit} noValidate>
        {/* ── Duplicate / blacklist warning banner ─────────────────────────── */}
        {duplicates && duplicates.matches.length > 0 ? (
          <div
            className={cn(
              'mb-4 rounded-card border p-4',
              blacklistedMatch
                ? 'border-danger-ring bg-danger-tint'
                : 'border-warn-ring bg-warn-tint',
            )}
          >
            <div className="flex gap-3">
              <Icons.ShieldAlert
                size={ICON_SIZE.lg}
                strokeWidth={ICON_STROKE}
                className={cn('mt-0.5 shrink-0', blacklistedMatch ? 'text-danger' : 'text-warn')}
              />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-semibold', blacklistedMatch ? 'text-danger' : 'text-warn')}>
                  {blacklistedMatch
                    ? 'This person is blacklisted'
                    : 'Possible existing applicant found'}
                </p>
                <p className="mt-0.5 text-xs text-ink-2">
                  {blacklistedMatch
                    ? 'A new application cannot be opened without an Admin override, which is recorded in the audit log.'
                    : 'One applicant should have one profile. Open the existing one and add a record to it rather than creating a duplicate.'}
                </p>

                <ul className="mt-3 space-y-2">
                  {duplicates.matches.map((match) => (
                    <li
                      key={match.applicantId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-white p-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink">
                            {match.fullName}
                          </span>
                          {match.isBlacklisted ? (
                            <Icons.Ban size={13} strokeWidth={2.2} className="text-danger" />
                          ) : null}
                        </span>
                        <span className="block text-[10px] text-ink-3">
                          {match.applicantCode} · {match.maskedMobile} · {match.maskedEmail}
                          {match.city ? ` · ${match.city}` : ''} · {match.recordCount} record
                          {match.recordCount === 1 ? '' : 's'}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {match.reasons.map((reason) => (
                            <span
                              key={reason}
                              className="rounded bg-slate2-tint px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-2"
                            >
                              {reason.replace(/_/g, ' ')} match
                            </span>
                          ))}
                        </span>
                      </span>

                      <Link to={`/applicants/${match.applicantId}`}>
                        <Button size="sm" variant="secondary" iconRight={Icons.ChevronRight}>
                          Open profile
                        </Button>
                      </Link>
                    </li>
                  ))}
                </ul>

                {blockingDuplicate ? (
                  <div className="mt-3 space-y-2 border-t border-black/5 pt-3">
                    <Checkbox
                      label={
                        blacklistedMatch
                          ? 'Override the blacklist and create anyway (Admin only)'
                          : 'This really is a different person — create a new profile'
                      }
                      checked={overrideDuplicate}
                      onChange={(event) => setOverrideDuplicate(event.target.checked)}
                    />
                    {overrideDuplicate ? (
                      <Input
                        placeholder="Reason for the override — recorded in the audit log"
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {/* Section A — personal */}
            <Card>
              <CardHeader title="Section A · Personal details" icon={Icons.User} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Full name"
                  required
                  value={form.fullName}
                  onChange={(event) => set('fullName')(event.target.value)}
                  error={errors.fullName}
                  containerClassName="sm:col-span-2"
                  autoFocus
                />
                <Input
                  label="Father's name"
                  value={form.fatherName}
                  onChange={(event) => set('fatherName')(event.target.value)}
                />
                <Input
                  label="Mother's name"
                  value={form.motherName}
                  onChange={(event) => set('motherName')(event.target.value)}
                />
                <Input
                  label="Date of birth"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(event) => set('dateOfBirth')(event.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  error={errors.dateOfBirth}
                  hint={isMinor ? 'Under 18 — guardian consent required' : undefined}
                />
                <Select
                  label="Gender"
                  placeholder="Select"
                  value={form.gender}
                  onChange={(event) => set('gender')(event.target.value)}
                  options={Object.values(GENDER).map((value) => ({
                    value,
                    label: value.charAt(0).toUpperCase() + value.slice(1),
                  }))}
                />
                <Input
                  label="Mobile"
                  required
                  value={form.mobile}
                  onChange={(event) => set('mobile')(event.target.value)}
                  error={errors.mobile}
                  placeholder="9876543210"
                  inputMode="tel"
                  prefix={<Icons.Phone size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
                />
                <Input
                  label="WhatsApp"
                  value={form.whatsapp}
                  onChange={(event) => set('whatsapp')(event.target.value)}
                  placeholder="Same as mobile if blank"
                  inputMode="tel"
                />
                <Input
                  label="Email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => set('email')(event.target.value)}
                  error={errors.email}
                  containerClassName="sm:col-span-2"
                  prefix={<Icons.Mail size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
                />
                <Input
                  label="Address"
                  value={form.addressLine}
                  onChange={(event) => set('addressLine')(event.target.value)}
                  containerClassName="sm:col-span-2"
                />
                <Input label="City" value={form.city} onChange={(event) => set('city')(event.target.value)} />
                <Input label="State" value={form.state} onChange={(event) => set('state')(event.target.value)} />
                <Input
                  label="Country"
                  value={form.country}
                  onChange={(event) => set('country')(event.target.value)}
                />
                <Input
                  label="PIN code"
                  value={form.pincode}
                  onChange={(event) => set('pincode')(event.target.value)}
                  error={errors.pincode}
                  inputMode="numeric"
                />
                <Input
                  label="Nationality"
                  value={form.nationality}
                  onChange={(event) => set('nationality')(event.target.value)}
                />
                <Input
                  label="Aadhaar number"
                  value={form.aadhaarNumber}
                  onChange={(event) => set('aadhaarNumber')(event.target.value)}
                  error={errors.aadhaarNumber}
                  inputMode="numeric"
                  placeholder="12 digits"
                  hint="Encrypted at rest; shown masked to everyone afterwards"
                  prefix={<Icons.Shield size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
                />
              </div>
            </Card>

            {/* Section B — record & achievement */}
            <Card>
              <CardHeader title="Section B · Record & achievement" icon={Icons.Award} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Record title"
                  required
                  value={form.recordTitle}
                  onChange={(event) => set('recordTitle')(event.target.value)}
                  error={errors.recordTitle}
                  containerClassName="sm:col-span-2"
                  placeholder="e.g. Longest time doing push-ups"
                />
                <Select
                  label="Category"
                  required
                  placeholder="Select a category"
                  value={form.categoryId}
                  onChange={(event) => set('categoryId')(event.target.value)}
                  error={errors.categoryId}
                  options={(lookups?.categories ?? []).map((category) => ({
                    value: category.id,
                    label: category.name,
                  }))}
                />
                <Select
                  label="Record type"
                  value={form.recordType}
                  onChange={(event) => set('recordType')(event.target.value)}
                  options={[
                    { value: RECORD_TYPE.INDIVIDUAL, label: 'Individual' },
                    { value: RECORD_TYPE.GROUP, label: 'Group' },
                  ]}
                />
                <Input
                  label="Date of achievement"
                  type="date"
                  value={form.achievementDate}
                  onChange={(event) => set('achievementDate')(event.target.value)}
                />
                <Input
                  label="Location"
                  value={form.location}
                  onChange={(event) => set('location')(event.target.value)}
                />
                <Input
                  label="Participants"
                  type="number"
                  min={1}
                  value={form.participantCount}
                  onChange={(event) => set('participantCount')(event.target.value)}
                  error={errors.participantCount}
                  hint={form.recordType === RECORD_TYPE.GROUP ? 'A group record needs more than one' : undefined}
                />
                <Textarea
                  label="Description"
                  value={form.description}
                  onChange={(event) => set('description')(event.target.value)}
                  containerClassName="sm:col-span-2"
                  rows={3}
                  placeholder="What was attempted, and how it was measured."
                />
              </div>
            </Card>

            {/* DPDP consent */}
            <Card>
              <CardHeader
                title="Consent (DPDP Act, 2023)"
                subtitle={`Recorded against notice version ${CONSENT_NOTICE_VERSION} and kept permanently.`}
                icon={Icons.Shield}
              />

              <div className="space-y-3">
                <div className="rounded-lg border border-line bg-canvas p-3">
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-3">
                    Required to process the application
                  </p>
                  <ul className="space-y-1.5">
                    {ESSENTIAL_PURPOSES.map((purpose) => (
                      <li key={purpose} className="flex items-start gap-2 text-xs text-ink-2">
                        <Icons.CheckCircle2
                          size={14}
                          strokeWidth={2}
                          className="mt-0.5 shrink-0 text-ok"
                        />
                        <span>{PURPOSE_META[purpose].label}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-3">
                    Optional — the applicant may decline these
                  </p>
                  <div className="space-y-2">
                    {OPTIONAL_PURPOSES.map((purpose) => (
                      <Checkbox
                        key={purpose}
                        label={PURPOSE_META[purpose].label}
                        hint={PURPOSE_META[purpose].notice}
                        checked={consentPurposes.includes(purpose)}
                        onChange={(event) =>
                          setConsentPurposes((previous) =>
                            event.target.checked
                              ? [...previous, purpose]
                              : previous.filter((item) => item !== purpose),
                          )
                        }
                      />
                    ))}
                  </div>
                </div>

                <Select
                  label="How was consent given?"
                  value={consentChannel}
                  onChange={(event) => setConsentChannel(event.target.value)}
                  options={Object.values(CONSENT_CHANNEL).map((value) => ({
                    value,
                    label: value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
                  }))}
                />

                {isMinor ? (
                  <div className="space-y-3 rounded-lg border border-warn-ring bg-warn-tint p-3">
                    <p className="flex items-start gap-2 text-xs font-semibold text-warn">
                      <Icons.ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                      Applicant is under 18 — DPDP §9 requires verifiable consent from a parent or
                      guardian.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Input
                        label="Guardian name"
                        required
                        value={guardianName}
                        onChange={(event) => setGuardianName(event.target.value)}
                        error={errors.guardianName}
                      />
                      <Input
                        label="Relationship"
                        value={guardianRelationship}
                        onChange={(event) => setGuardianRelationship(event.target.value)}
                        placeholder="Mother / Father / Guardian"
                      />
                      <Input
                        label="Guardian contact"
                        value={guardianContact}
                        onChange={(event) => setGuardianContact(event.target.value)}
                        inputMode="tel"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          </div>

          {/* Sidebar — application meta + save */}
          <div className="space-y-4">
            <Card>
              <CardHeader title="Application" icon={Icons.FileText} />
              <div className="space-y-3">
                <Select
                  label="Source"
                  value={form.source}
                  onChange={(event) => set('source')(event.target.value)}
                  options={Object.values(APPLICATION_SOURCE)
                    .filter((source) => source !== APPLICATION_SOURCE.NBR_WEBSITE_SYNC)
                    .map((source) => ({
                      value: source,
                      label: APPLICATION_SOURCE_LABELS[source],
                    }))}
                />
                <Select
                  label="Assign to"
                  placeholder="Unassigned"
                  value={form.assignedToUserId}
                  onChange={(event) => set('assignedToUserId')(event.target.value)}
                  options={(lookups?.staff ?? []).map((member) => ({
                    value: member.id,
                    label: `${member.fullName} — ${member.roleName}`,
                  }))}
                />
                <Select
                  label="Starting status"
                  value={form.initialStatus}
                  onChange={(event) => set('initialStatus')(event.target.value)}
                  options={[
                    { value: RECORD_STATUS.NEW_LEAD, label: 'New Lead' },
                    { value: RECORD_STATUS.APPLICATION_SUBMITTED, label: 'Application Submitted' },
                    { value: RECORD_STATUS.UNDER_REVIEW, label: 'Under Review' },
                  ]}
                />
                <Textarea
                  label="Internal remarks"
                  value={form.internalRemarks}
                  onChange={(event) => set('internalRemarks')(event.target.value)}
                  rows={3}
                  placeholder="Visible to staff only."
                />
              </div>
            </Card>

            <Card>
              <p className="mb-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
                <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
                IDs are allocated automatically — <span className="tabular">NBRAP#####</span> for
                the applicant, <span className="tabular">NBRR#####</span> for the record.
              </p>

              <div className="space-y-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  loading={createMutation.isPending}
                  disabled={blockingDuplicate && !overrideDuplicate}
                >
                  Save &amp; open profile
                </Button>
                <Button variant="ghost" block onClick={() => navigate('/applicants')}>
                  Cancel
                </Button>
              </div>

              {blockingDuplicate && !overrideDuplicate ? (
                <p className="mt-2 text-center text-[11px] text-warn">
                  Resolve the duplicate warning above to continue.
                </p>
              ) : null}
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
