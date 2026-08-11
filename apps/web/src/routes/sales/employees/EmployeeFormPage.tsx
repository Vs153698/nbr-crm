import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DEFAULT_DEPARTMENTS,
  EMPLOYEE_STATUS,
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPE_LABELS,
} from '@nbr/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, QueryError } from '@/components/ui/Card';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api-client';
import { ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { employeeKeys, type EmployeeDetail, type EmployeeRow } from './types';

/**
 * Every field on the record, in the order the form asks for them.
 *
 * The list is exhaustive against `employeeSchema` on purpose: a field the API
 * accepts but the form never offers is a value nobody can ever set, which is
 * how salary, probation, PAN and bank details sat unreachable on this record
 * while the profile had places to show them.
 */
const EMPTY_FORM = {
  employeeCode: '',
  fullName: '',
  mobile: '',
  alternatePhone: '',
  workEmail: '',
  personalEmail: '',
  dateOfBirth: '',
  gender: '',

  department: '',
  designation: '',
  employmentType: EMPLOYMENT_TYPE.FULL_TIME as string,
  status: EMPLOYEE_STATUS.ACTIVE as string,
  joinedOn: '',
  probationEndsOn: '',
  exitedOn: '',
  workLocation: '',
  reportsToEmployeeId: '',
  userId: '',

  monthlySalary: '',
  ctc: '',
  panNumber: '',
  bankName: '',
  bankAccountNumber: '',

  addressLine: '',
  city: '',
  state: '',
  pincode: '',

  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
  emergencyContactAddress: '',

  notes: '',
  isDirectoryVisible: true,
};

interface CreateEmployeeResponse {
  id: string;
  employeeCode: string;
  account?: {
    userId: string;
    email: string;
    credentialsEmailed: boolean;
    /** Present only when the joining email was suppressed or failed. */
    temporaryPassword: string | null;
  };
}

type FormState = typeof EMPTY_FORM;
type TextField = Exclude<keyof FormState, 'isDirectoryVisible'>;

/** Mirrors `employeeCodeSchema` — the server rejects the same shapes. */
const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

function employeeCodeError(code: string): string | undefined {
  const value = code.trim();
  if (value.length === 0) return undefined;
  if (value.length < 2) return 'An employee ID needs at least 2 characters.';
  if (value.length > 30) return 'Keep it to 30 characters or fewer.';
  if (!EMPLOYEE_CODE_PATTERN.test(value)) return 'Use letters, numbers, and - / _ only.';
  return undefined;
}

/** Mirrors `moneySchema` — up to ten digits and two decimal places. */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

function moneyError(value: string): string | undefined {
  if (value.trim().length === 0) return undefined;
  return MONEY_PATTERN.test(value.trim()) ? undefined : 'Enter an amount like 45000 or 45000.50.';
}

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'undisclosed', label: 'Prefer not to say' },
];

/**
 * Add or edit an employee — a page, not a dialog.
 *
 * The record carries forty-odd fields across identity, employment, pay,
 * statutory details, address and next of kin. A modal could hold a third of
 * them, which is why two thirds were missing: there was nowhere to put them.
 * A page has the room, can be linked to, and survives a reload mid-entry.
 */
export default function EmployeeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const isNew = !id;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(isNew);
  /**
   * New joiners normally arrive with an ID already decided — printed on the
   * card, quoted by payroll — so the field is typed in. Auto-allocation stays
   * available for the case where HR has not assigned one yet.
   */
  const [autoAllocate, setAutoAllocate] = useState(false);

  /**
   * The login to create alongside the record.
   *
   * Off by default: the directory holds field staff, contractors and drivers
   * who will never sign in, and an account nobody asked for is an extra way in
   * that nobody is watching.
   */
  const [withAccount, setWithAccount] = useState(false);
  const [accountRoleId, setAccountRoleId] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [sendCredentials, setSendCredentials] = useState(true);
  /** Shown once, when the joining email was suppressed or could not be sent. */
  const [handoverPassword, setHandoverPassword] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const [searchParams] = useSearchParams();
  const fromUserId = searchParams.get('fromUser');

  const { data: colleagues } = useQuery({
    queryKey: ['employees', 'all-for-manager'],
    queryFn: ({ signal }) => api.get<{ items: EmployeeRow[] }>('/employees', { limit: 200 }, signal),
  });

  // Linking a login account is an admin concern, so the picker only appears for
  // someone who can already see the user list. Everyone else keeps the field's
  // current value untouched.
  const canLinkAccount = can('users:view');
  const { data: users } = useQuery({
    queryKey: ['users'],
    enabled: canLinkAccount,
    queryFn: ({ signal }) =>
      api.get<Array<{ id: string; fullName: string; email: string }>>('/users', undefined, signal),
  });

  // Choosing a role needs the role list, which is its own permission — someone
  // who can add users but not read roles gets the account section hidden rather
  // than an empty dropdown they cannot fill in.
  const canChooseRole = can('roles:view') && can('users:create');
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    enabled: canChooseRole && isNew,
    queryFn: ({ signal }) =>
      api.get<Array<{ id: string; name: string; isSuperAdmin: boolean }>>(
        '/roles',
        undefined,
        signal,
      ),
  });

  /**
   * Arriving from Users & Roles → "Create employee record".
   *
   * The account already exists, so the form starts from what it knows and links
   * to it rather than offering to create a second one.
   */
  const sourceUser = useMemo(
    () => (fromUserId ? users?.find((user) => user.id === fromUserId) : undefined),
    [fromUserId, users],
  );

  useEffect(() => {
    if (!isNew || !sourceUser) return;
    setForm((current) => ({
      ...current,
      fullName: current.fullName || sourceUser.fullName,
      workEmail: current.workEmail || sourceUser.email,
      userId: sourceUser.id,
    }));
  }, [isNew, sourceUser]);

  const {
    data: detail,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: employeeKeys.detail(id ?? ''),
    enabled: !isNew,
    queryFn: ({ signal }) => api.get<EmployeeDetail>(`/employees/${id}`, undefined, signal),
  });

  /**
   * Fill the form from whatever the query has, once.
   *
   * Keyed off the data rather than done inside `queryFn`, because arriving from
   * the profile means this record is already cached and a cached read never
   * calls `queryFn`. Guarding on `loaded` is what stops a background refetch
   * overwriting what is being typed.
   *
   * Fields are copied by name rather than spread: the detail payload also
   * carries `reports`, `documentCount` and the resolved manager name, none of
   * which belong in a form.
   */
  useEffect(() => {
    if (loaded || !detail) return;

    const next = { ...EMPTY_FORM };
    for (const key of Object.keys(EMPTY_FORM) as Array<keyof FormState>) {
      if (key === 'isDirectoryVisible') continue;
      const value = (detail as unknown as Record<string, unknown>)[key];
      next[key as TextField] = value === null || value === undefined ? '' : String(value);
    }
    setForm(next);
    setLoaded(true);
  }, [detail, loaded]);

  const set = (key: TextField) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const codeError = autoAllocate ? undefined : employeeCodeError(form.employeeCode);
  const codeMissing = isNew && !autoAllocate && form.employeeCode.trim().length === 0;
  const salaryError = moneyError(form.monthlySalary);
  const ctcError = moneyError(form.ctc);

  const exitBeforeJoin =
    form.joinedOn && form.exitedOn && new Date(form.exitedOn) < new Date(form.joinedOn);
  const probationBeforeJoin =
    form.joinedOn &&
    form.probationEndsOn &&
    new Date(form.probationEndsOn) < new Date(form.joinedOn);

  const managerOptions = useMemo(
    () =>
      (colleagues?.items ?? [])
        // Excluding self keeps the org chart from looping; the server refuses
        // it too.
        .filter((person) => person.id !== id)
        .map((person) => ({
          value: person.id,
          label: `${person.fullName}${person.designation ? ` — ${person.designation}` : ''}`,
        })),
    [colleagues, id],
  );

  const save = useMutation({
    mutationFn: () => {
      /**
       * An empty field means "not provided", not "set to blank".
       *
       * The API's optional strings reject a blank email as malformed and treat
       * an omitted key as no change, so blanks are dropped rather than sent.
       * The consequence worth knowing: clearing a value that is already set is
       * not something this form can do.
       */
      const payload: Record<string, unknown> = { isDirectoryVisible: form.isDirectoryVisible };

      for (const key of Object.keys(EMPTY_FORM) as Array<keyof FormState>) {
        if (key === 'isDirectoryVisible') continue;
        // Omitting the code is what asks the server to allocate one.
        if (key === 'employeeCode' && autoAllocate) continue;

        const value = form[key as TextField];
        if (typeof value !== 'string' || value.trim().length === 0) continue;
        payload[key] = value.trim();
      }

      if (isNew && withAccount) {
        payload.account = {
          roleId: accountRoleId,
          email: accountEmail.trim() || undefined,
          sendCredentials,
        };
      }

      return isNew
        ? api.post<CreateEmployeeResponse>('/employees', payload)
        : api.put(`/employees/${id}`, payload);
    },
    onSuccess: (result: unknown) => {
      const created = result as CreateEmployeeResponse | undefined;
      toast.success(
        isNew
          ? `Employee added${created?.employeeCode ? ` — ${created.employeeCode}` : ''}`
          : 'Employee updated',
      );
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: employeeKeys.detail(id ?? '') });

      /*
        A generated password the server could not email has to reach the
        employee somehow, and this response is the only time it exists in
        readable form. Hold the page open and show it rather than navigating
        away with it lost.
      */
      const account = created?.account;
      if (account?.temporaryPassword) {
        setHandoverPassword({ email: account.email, password: account.temporaryPassword });
        return;
      }

      if (account) {
        toast.info('Login created', {
          description: `Sign-in details were emailed to ${account.email}.`,
        });
      }

      navigate(created?.id ? `/employees/${created.id}` : id ? `/employees/${id}` : '/employees');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the employee'),
  });

  const blocked =
    !form.fullName.trim() ||
    form.mobile.trim().length < 10 ||
    Boolean(codeError) ||
    codeMissing ||
    Boolean(salaryError) ||
    Boolean(ctcError) ||
    Boolean(exitBeforeJoin) ||
    Boolean(probationBeforeJoin) ||
    // An account with no role is either useless or dangerous; the server
    // refuses one too.
    (withAccount && !accountRoleId) ||
    (withAccount && !accountEmail.trim() && !form.workEmail.trim());

  if (isError) {
    return (
      <div className="p-5">
        <Card>
          <QueryError
            title="Couldn't load this employee"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void refetch()}
          />
        </Card>
      </div>
    );
  }

  const cancelTo = id ? `/employees/${id}` : '/employees';

  /**
   * The password, shown once because there is nowhere else to see it.
   *
   * Reached only when the joining email was turned off or the send failed. The
   * server stores a hash and nothing else, so navigating away loses it for
   * good — which is why this replaces the page rather than being a toast that
   * disappears on its own.
   */
  if (handoverPassword) {
    return (
      <div className="p-4 sm:p-5">
        <div className="mx-auto max-w-xl">
          <Card>
            <div className="flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warn-tint text-warn">
                <Icons.Lock size={18} strokeWidth={ICON_STROKE} />
              </span>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-ink">Pass these details on</h1>
                <p className="mt-1 text-xs text-ink-2">
                  The sign-in details were not emailed, so this is the only time the password can
                  be read. It works once and is replaced when they first sign in.
                </p>
              </div>
            </div>

            <dl className="mt-4 space-y-2 rounded-lg border border-line bg-canvas p-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-xs text-ink-3">Email</dt>
                <dd className="tabular truncate font-mono text-xs font-semibold text-ink">
                  {handoverPassword.email}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-xs text-ink-3">Temporary password</dt>
                <dd className="tabular select-all font-mono text-sm font-bold text-ink">
                  {handoverPassword.password}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                icon={Icons.Copy}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(handoverPassword.password)
                    .then(() => toast.success('Password copied'))
                    .catch(() => toast.error('Could not copy — select it and copy by hand'));
                }}
              >
                Copy password
              </Button>
              <Button variant="primary" onClick={() => navigate('/employees')}>
                Done
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-5 sm:pb-24">
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
          <li>
            <Link to="/" className="transition-colors hover:text-brand">
              Dashboard
            </Link>
          </li>
          <li aria-hidden>
            <Icons.ChevronRight size={12} strokeWidth={ICON_STROKE} />
          </li>
          <li>
            <Link to="/employees" className="transition-colors hover:text-brand">
              Employees
            </Link>
          </li>
          {detail ? (
            <>
              <li aria-hidden>
                <Icons.ChevronRight size={12} strokeWidth={ICON_STROKE} />
              </li>
              <li>
                <Link to={`/employees/${id}`} className="truncate transition-colors hover:text-brand">
                  {detail.fullName}
                </Link>
              </li>
            </>
          ) : null}
          <li aria-hidden>
            <Icons.ChevronRight size={12} strokeWidth={ICON_STROKE} />
          </li>
          <li className="font-medium text-ink-2" aria-current="page">
            {isNew ? 'New' : 'Edit'}
          </li>
        </ol>
      </nav>

      <PageHeader
        title={isNew ? 'Add employee' : `Edit ${detail?.fullName ?? 'employee'}`}
        subtitle="Directory record. A login account is optional and linked separately."
        back={{ to: cancelTo, label: id ? 'Back to profile' : 'Back to Employees' }}
      />

      {!loaded ? (
        <div className="space-y-4">
          <div className="skeleton h-32" />
          <div className="skeleton h-64" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* The ID leads the form because it is the field HR is holding a
              printed card to fill in, and burying it invites a blank. */}
          <section className="rounded-card border border-brand-ring bg-brand-tint/40 p-4">
            <SectionTitle icon={Icons.ScanBarcode} label="Employee ID" accent />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Employee ID"
                required={isNew && !autoAllocate}
                value={autoAllocate ? '' : form.employeeCode}
                disabled={autoAllocate}
                onChange={(event) => set('employeeCode')(event.target.value.toUpperCase())}
                placeholder="NBREMP014"
                error={codeError}
                hint={
                  autoAllocate
                    ? 'The next ID in sequence is allocated when you save.'
                    : 'Type the ID from the joining paperwork. Stored in capitals.'
                }
                className="tabular font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex items-start pt-6">
                <Checkbox
                  label="Allocate one automatically"
                  hint="Use when no ID has been assigned yet."
                  checked={autoAllocate}
                  onChange={(event) => setAutoAllocate(event.target.checked)}
                />
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle icon={Icons.User} label="Person" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Full name"
                  required
                  value={form.fullName}
                  onChange={(event) => set('fullName')(event.target.value)}
                  containerClassName="sm:col-span-2"
                />
                <Input
                  label="Mobile"
                  required
                  value={form.mobile}
                  hint="10-digit Indian mobile."
                  onChange={(event) => set('mobile')(event.target.value)}
                />
                <Input
                  label="Alternate phone"
                  value={form.alternatePhone}
                  onChange={(event) => set('alternatePhone')(event.target.value)}
                />
                <Input
                  label="Work email"
                  type="email"
                  value={form.workEmail}
                  onChange={(event) => set('workEmail')(event.target.value)}
                />
                <Input
                  label="Personal email"
                  type="email"
                  value={form.personalEmail}
                  onChange={(event) => set('personalEmail')(event.target.value)}
                />
                <Input
                  type="date"
                  label="Date of birth"
                  value={form.dateOfBirth}
                  onChange={(event) => set('dateOfBirth')(event.target.value)}
                />
                <Select
                  label="Gender"
                  value={form.gender}
                  placeholder="Not recorded"
                  options={GENDER_OPTIONS}
                  onChange={(event) => set('gender')(event.target.value)}
                />
              </div>
            </Card>

            <Card>
              <SectionTitle icon={Icons.Briefcase} label="Employment" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Department"
                  value={form.department}
                  onChange={(event) => set('department')(event.target.value)}
                  placeholder="Select a department"
                  options={DEFAULT_DEPARTMENTS.map((name) => ({ value: name, label: name }))}
                />
                <Input
                  label="Designation"
                  value={form.designation}
                  onChange={(event) => set('designation')(event.target.value)}
                />
                <Select
                  label="Employment type"
                  value={form.employmentType}
                  onChange={(event) => set('employmentType')(event.target.value)}
                  options={Object.values(EMPLOYMENT_TYPE).map((value) => ({
                    value,
                    label: EMPLOYMENT_TYPE_LABELS[value],
                  }))}
                />
                <Select
                  label="Status"
                  value={form.status}
                  onChange={(event) => set('status')(event.target.value)}
                  options={Object.entries(EMPLOYEE_STATUS_META).map(([value, meta]) => ({
                    value,
                    label: meta.label,
                  }))}
                />
                <Input
                  type="date"
                  label="Joined on"
                  value={form.joinedOn}
                  onChange={(event) => set('joinedOn')(event.target.value)}
                />
                <Input
                  type="date"
                  label="Probation ends"
                  value={form.probationEndsOn}
                  hint="Leave blank when probation does not apply."
                  error={probationBeforeJoin ? 'Probation cannot end before the joining date.' : undefined}
                  onChange={(event) => set('probationEndsOn')(event.target.value)}
                />
                <Input
                  type="date"
                  label="Exited on"
                  value={form.exitedOn}
                  error={exitBeforeJoin ? 'An exit cannot precede the joining date.' : undefined}
                  onChange={(event) => set('exitedOn')(event.target.value)}
                />
                <Input
                  label="Work location"
                  value={form.workLocation}
                  onChange={(event) => set('workLocation')(event.target.value)}
                />
                <Select
                  label="Reporting manager"
                  value={form.reportsToEmployeeId}
                  onChange={(event) => set('reportsToEmployeeId')(event.target.value)}
                  placeholder="Nobody"
                  options={managerOptions}
                  containerClassName="sm:col-span-2"
                />
                {canLinkAccount ? (
                  <Select
                    label="Login account"
                    value={form.userId}
                    onChange={(event) => set('userId')(event.target.value)}
                    placeholder="No login"
                    hint="Only for employees who sign in to the CRM."
                    options={(users ?? []).map((user) => ({
                      value: user.id,
                      label: `${user.fullName} — ${user.email}`,
                    }))}
                    containerClassName="sm:col-span-2"
                  />
                ) : null}
              </div>
            </Card>

            <Card>
              <SectionTitle icon={Icons.Wallet} label="Compensation & statutory" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Monthly salary (₹)"
                  value={form.monthlySalary}
                  inputMode="decimal"
                  placeholder="45000"
                  error={salaryError}
                  hint="Basic pay a payslip is pro-rated from."
                  onChange={(event) => set('monthlySalary')(event.target.value)}
                />
                <Input
                  label="Annual CTC (₹)"
                  value={form.ctc}
                  inputMode="decimal"
                  placeholder="600000"
                  error={ctcError}
                  onChange={(event) => set('ctc')(event.target.value)}
                />
                <Input
                  label="PAN"
                  value={form.panNumber}
                  className="uppercase"
                  onChange={(event) => set('panNumber')(event.target.value.toUpperCase())}
                />
                <Input
                  label="Bank name"
                  value={form.bankName}
                  onChange={(event) => set('bankName')(event.target.value)}
                />
                <Input
                  label="Bank account number"
                  value={form.bankAccountNumber}
                  hint="Shown masked to the last four digits on the profile."
                  onChange={(event) => set('bankAccountNumber')(event.target.value)}
                  containerClassName="sm:col-span-2"
                />
              </div>
            </Card>

            <Card>
              <SectionTitle icon={Icons.MapPin} label="Address" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Address"
                  value={form.addressLine}
                  onChange={(event) => set('addressLine')(event.target.value)}
                  containerClassName="sm:col-span-2"
                />
                <Input
                  label="City"
                  value={form.city}
                  onChange={(event) => set('city')(event.target.value)}
                />
                <Input
                  label="State"
                  value={form.state}
                  onChange={(event) => set('state')(event.target.value)}
                />
                <Input
                  label="PIN code"
                  value={form.pincode}
                  inputMode="numeric"
                  onChange={(event) => set('pincode')(event.target.value)}
                />
              </div>
            </Card>

            <Card>
              <SectionTitle icon={Icons.PhoneCall} label="Emergency contact" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Name"
                  value={form.emergencyContactName}
                  onChange={(event) => set('emergencyContactName')(event.target.value)}
                />
                <Input
                  label="Relationship"
                  value={form.emergencyContactRelation}
                  placeholder="Spouse, parent, sibling"
                  onChange={(event) => set('emergencyContactRelation')(event.target.value)}
                />
                <Input
                  label="Phone"
                  value={form.emergencyContactPhone}
                  onChange={(event) => set('emergencyContactPhone')(event.target.value)}
                />
                <Input
                  label="Address"
                  value={form.emergencyContactAddress}
                  onChange={(event) => set('emergencyContactAddress')(event.target.value)}
                  containerClassName="sm:col-span-2"
                />
              </div>
            </Card>

            {/*
              The login, asked for at the moment the person is created.

              Two accounts for one human is the failure this prevents: HR adds
              the employee, an admin separately adds a user, and nothing links
              them. Creating both here links them in one step, and the role is
              asked for because an account without one cannot be granted safely.
            */}
            {isNew && canChooseRole && !sourceUser ? (
              <Card>
                <SectionTitle icon={Icons.Lock} label="Login access" />
                <div className="space-y-4">
                  <Checkbox
                    label="Create a login for this employee"
                    hint="Leave off for staff who will never sign in to the CRM."
                    checked={withAccount}
                    onChange={(event) => setWithAccount(event.target.checked)}
                  />

                  {withAccount ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Select
                        label="Role"
                        required
                        value={accountRoleId}
                        placeholder="Choose a role"
                        hint="Decides what they can see and do."
                        onChange={(event) => setAccountRoleId(event.target.value)}
                        options={(roles ?? []).map((role) => ({
                          value: role.id,
                          label: role.name,
                        }))}
                      />
                      <Input
                        label="Sign-in email"
                        type="email"
                        value={accountEmail}
                        placeholder={form.workEmail || 'Needed to sign in'}
                        hint={
                          form.workEmail
                            ? 'Blank uses the work email above.'
                            : 'No work email is set, so give one here.'
                        }
                        onChange={(event) => setAccountEmail(event.target.value)}
                      />
                      <Checkbox
                        label="Email the sign-in details"
                        hint="Off means the password is shown to you once, to pass on yourself."
                        checked={sendCredentials}
                        onChange={(event) => setSendCredentials(event.target.checked)}
                      />
                      <p className="text-xs text-ink-3 sm:col-span-2">
                        A one-time password is generated and replaced the first time they sign in.
                      </p>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {/* Arrived from Users & Roles: the account exists already. */}
            {isNew && sourceUser ? (
              <Card>
                <SectionTitle icon={Icons.Lock} label="Login access" />
                <p className="text-sm text-ink-2">
                  This record will be linked to the existing login{' '}
                  <span className="font-semibold text-ink">{sourceUser.email}</span>. Their password
                  and role are unchanged.
                </p>
              </Card>
            ) : null}

            <Card>
              <SectionTitle icon={Icons.StickyNote} label="Notes & visibility" />
              <div className="space-y-4">
                <Textarea
                  label="Notes"
                  value={form.notes}
                  rows={4}
                  maxLength={4000}
                  onChange={(event) => set('notes')(event.target.value)}
                />
                <Checkbox
                  label="Show in the directory"
                  hint="Turn off for a record that should not appear in the staff list."
                  checked={form.isDirectoryVisible}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, isDirectoryVisible: event.target.checked }))
                  }
                />
              </div>
            </Card>
          </div>

          {isNew ? (
            <p className="rounded-card border border-line bg-canvas px-4 py-3 text-xs text-ink-3">
              Onboarding documents — offer letter, ID proof, certificates — are attached from the
              employee&apos;s profile once the record exists.
            </p>
          ) : null}
        </div>
      )}

      {/* A long form needs its actions reachable without scrolling to the end. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
        <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-2">
          {blocked ? (
            <p className="mr-auto text-xs text-ink-3">
              A name, a valid mobile{isNew ? ' and an employee ID' : ''} are needed to save.
            </p>
          ) : null}
          <Button variant="ghost" onClick={() => navigate(cancelTo)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={blocked || !loaded}
            onClick={() => save.mutate()}
          >
            {isNew ? 'Add employee' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon
        size={15}
        strokeWidth={ICON_STROKE}
        className={accent ? 'text-brand' : 'text-ink-3'}
        aria-hidden
      />
      <h2
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          accent ? 'text-brand' : 'text-ink-3'
        }`}
      >
        {label}
      </h2>
    </div>
  );
}
