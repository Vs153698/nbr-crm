import * as Tabs from '@radix-ui/react-tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, EmptyState } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { useNavigate } from 'react-router-dom';
import { RowActions, RowActionsCell } from '@/components/ui/RowActions';
import { Input, Select } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  designation: string | null;
  roleId: string;
  roleName: string;
  status: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  isLocked: boolean;
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isProtected: boolean;
  isSuperAdmin: boolean;
  userCount: number;
  permissions: string[];
}

interface PermissionModule {
  module: string;
  label: string;
  actions: Array<{ action: string; label: string; code: string }>;
}

/**
 * W-28 Users & Roles (P1-04).
 *
 * The permission grid writes to the same rows the API guards read, so what an
 * Admin sees here *is* the enforcement — not a parallel description of it.
 */
export default function UsersRolesPage() {
  const navigate = useNavigate();
  const { can, user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<UserRow | null>(null);

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: queryKeys.users,
    queryFn: ({ signal }) => api.get<UserRow[]>('/users', undefined, signal),
  });

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: ({ signal }) => api.get<RoleRow[]>('/roles', undefined, signal),
    enabled: can('roles:view'),
  });

  const { data: catalogue } = useQuery({
    queryKey: queryKeys.permissionCatalogue,
    queryFn: ({ signal }) => api.get<PermissionModule[]>('/roles/permission-catalogue', undefined, signal),
    enabled: can('roles:view'),
    staleTime: 30 * 60_000,
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/users/${userId}/revoke-sessions`),
    onSuccess: () => {
      toast.success('Sessions revoked', { description: 'That user must sign in again on every device.' });
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not revoke sessions'),
  });

  const userColumns: Array<Column<UserRow>> = [
    {
      key: 'name',
      header: 'User',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">
            {row.fullName}
            {row.id === currentUser?.id ? (
              <span className="ml-1.5 text-[10px] font-normal text-ink-3">(you)</span>
            ) : null}
          </p>
          <p className="truncate text-[10px] text-ink-3">
            {row.email}
            {row.employeeCode ? ` · ${row.employeeCode}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', width: '150px', render: (row) => <Chip tone="indigo">{row.roleName}</Chip> },
    {
      key: 'status',
      header: 'Status',
      width: '160px',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Chip tone={row.status === 'active' ? 'green' : 'slate'}>{row.status}</Chip>
          {row.isLocked ? <Chip tone="red">Locked</Chip> : null}
          {row.mustChangePassword ? <Chip tone="orange">Must reset</Chip> : null}
        </div>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      width: '140px',
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-ink-3">
          {row.lastLoginAt ? formatRelative(row.lastLoginAt) : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '110px',
      render: (row) => (
        <RowActionsCell>
          <RowActions
            label={`Actions for ${row.fullName}`}
            actions={[
              /*
                Give an existing login a directory record.
                
                The two are separate tables on purpose, and people arrive in
                either order — an account created first for someone who joined
                in a hurry still needs a joining date, a salary and a manager.
                This carries what the account already knows into the employee
                form rather than making somebody retype it.
              */
              ...(can('employees:create')
                ? [
                    {
                      id: 'to-employee',
                      label: 'Create employee record',
                      icon: Icons.UserPlus,
                      onSelect: () => navigate(`/employees/new?fromUser=${row.id}`),
                    },
                  ]
                : []),
              // Signing yourself out from here would be indistinguishable from
              // a bug.
              ...(can('users:edit') && row.id !== currentUser?.id
                ? [
                    {
                      id: 'revoke',
                      label: 'Sign out everywhere',
                      icon: Icons.LogOut,
                      danger: true,
                      onSelect: () => setRevokeTarget(row),
                    },
                  ]
                : []),
            ]}
          />
        </RowActionsCell>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Users & Roles"
        subtitle="Roles are database-driven — change a permission here and it takes effect immediately."
        actions={
          can('users:create') ? (
            <Button variant="primary" icon={Icons.UserPlus} onClick={() => setInviteOpen(true)}>
              Add user
            </Button>
          ) : null
        }
      />

      <Tabs.Root defaultValue="users">
        <Tabs.List className="mb-4 flex gap-1 border-b border-line">
          <Tabs.Trigger
            value="users"
            className="border-b-2 border-transparent px-3 py-2 text-xs font-medium text-ink-2 transition-colors data-[state=active]:border-brand data-[state=active]:text-brand"
          >
            Users ({users?.length ?? 0})
          </Tabs.Trigger>
          {can('roles:view') ? (
            <Tabs.Trigger
              value="roles"
              className="border-b-2 border-transparent px-3 py-2 text-xs font-medium text-ink-2 transition-colors data-[state=active]:border-brand data-[state=active]:text-brand"
            >
              Roles &amp; permissions ({roles?.length ?? 0})
            </Tabs.Trigger>
          ) : null}
        </Tabs.List>

        <Tabs.Content value="users">
          <Card padded={false}>
            <DataTable
              columns={userColumns}
              rows={users ?? []}
              rowKey={(row) => row.id}
              loading={usersLoading}
              emptyState={<EmptyState icon={Icons.Users} title="No users yet" />}
            />
          </Card>
        </Tabs.Content>

        <Tabs.Content value="roles">
          {rolesLoading ? (
            <div className="skeleton h-64" />
          ) : (
            <div className="space-y-3">
              {roles?.map((role) => (
                <Card key={role.id}>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        {role.name}
                        {role.isProtected ? (
                          <Chip tone="red">
                            <Icons.Lock size={10} strokeWidth={2} /> Protected
                          </Chip>
                        ) : role.isSystem ? (
                          <Chip tone="slate">System</Chip>
                        ) : null}
                      </span>
                    }
                    subtitle={role.description ?? undefined}
                    icon={Icons.Shield}
                    action={
                      <div className="flex items-center gap-2">
                        <span className="tabular text-[11px] text-ink-3">
                          {role.userCount} user{role.userCount === 1 ? '' : 's'} ·{' '}
                          {role.permissions.length} permissions
                        </span>
                        {can('roles:edit') && !role.isProtected ? (
                          <Button size="sm" variant="secondary" icon={Icons.PenLine} onClick={() => setEditingRole(role)}>
                            Edit grid
                          </Button>
                        ) : null}
                      </div>
                    }
                  />

                  {role.isProtected ? (
                    <p className="flex items-start gap-1.5 rounded-lg bg-canvas p-2.5 text-[11px] text-ink-3">
                      <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
                      Super Admin holds every permission implicitly and cannot be edited — that is
                      what guarantees the system can always be administered.
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>

      {inviteOpen ? <InviteUserDialog roles={roles ?? []} onClose={() => setInviteOpen(false)} /> : null}

      {editingRole && catalogue ? (
        <PermissionGridDialog
          role={editingRole}
          catalogue={catalogue}
          onClose={() => setEditingRole(null)}
        />
      ) : null}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Sign this user out everywhere?"
        message={
          <>
            <strong>{revokeTarget?.fullName}</strong> will be signed out on every device immediately
            and will need to sign in again. Use this if a device is lost or an account may be
            compromised.
          </>
        }
        confirmLabel="Revoke sessions"
        variant="warning"
        loading={revokeMutation.isPending}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
      />
    </div>
  );
}

function InviteUserDialog({ roles, onClose }: { roles: RoleRow[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ fullName: '', email: '', employeeCode: '', roleId: '', designation: '' });
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string; temporaryPassword: string | null }>('/users', {
        fullName: form.fullName,
        email: form.email,
        employeeCode: form.employeeCode || undefined,
        roleId: form.roleId,
        designation: form.designation || undefined,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      if (result.temporaryPassword) {
        // Shown exactly once — it is never retrievable afterwards.
        setTemporaryPassword(result.temporaryPassword);
      } else {
        toast.success('User created');
        onClose();
      }
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the user'),
  });

  if (temporaryPassword) {
    return (
      <Dialog
        open
        onOpenChange={onClose}
        title="User created"
        description="Share this temporary password securely. It will not be shown again."
        size="sm"
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-warn-ring bg-warn-tint p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-warn">
              Temporary password
            </p>
            <p className="mt-1 select-all break-all font-mono text-sm font-bold text-ink">
              {temporaryPassword}
            </p>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            The user must change this on first sign-in, and nothing else in the system is reachable
            for them until they do.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={createMutation.isPending}
            disabled={!form.fullName || !form.email || !form.roleId}
            onClick={() => createMutation.mutate()}
          >
            Create user
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Full name"
          required
          value={form.fullName}
          onChange={(event) => setForm((f) => ({ ...f, fullName: event.target.value }))}
          autoFocus
        />
        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Employee code"
            value={form.employeeCode}
            onChange={(event) => setForm((f) => ({ ...f, employeeCode: event.target.value }))}
          />
          <Input
            label="Designation"
            value={form.designation}
            onChange={(event) => setForm((f) => ({ ...f, designation: event.target.value }))}
          />
        </div>
        <Select
          label="Role"
          required
          placeholder="Choose a role"
          value={form.roleId}
          onChange={(event) => setForm((f) => ({ ...f, roleId: event.target.value }))}
          options={roles
            .filter((role) => !role.isSuperAdmin)
            .map((role) => ({ value: role.id, label: role.name }))}
        />
      </div>
    </Dialog>
  );
}

function PermissionGridDialog({
  role,
  catalogue,
  onClose,
}: {
  role: RoleRow;
  catalogue: PermissionModule[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions));
  const [name, setName] = useState(role.name);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/roles/${role.id}`, {
        name,
        description: role.description ?? undefined,
        permissions: [...selected],
      }),
    onSuccess: () => {
      toast.success('Role updated', { description: 'Takes effect immediately for everyone in it.' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the role'),
  });

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModule(module: PermissionModule) {
    const codes = module.actions.map((action) => action.code);
    const allSelected = codes.every((code) => selected.has(code));
    setSelected((current) => {
      const next = new Set(current);
      for (const code of codes) {
        if (allSelected) next.delete(code);
        else next.add(code);
      }
      return next;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Permissions — ${role.name}`}
      description={`${selected.size} of ${catalogue.reduce((sum, m) => sum + m.actions.length, 0)} permissions granted. Applies to ${role.userCount} user${role.userCount === 1 ? '' : 's'}.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            Save permissions
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Role name" value={name} onChange={(event) => setName(event.target.value)} />

        <div className="space-y-2">
          {catalogue.map((module) => {
            const codes = module.actions.map((action) => action.code);
            const grantedCount = codes.filter((code) => selected.has(code)).length;

            return (
              <div key={module.module} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-ink">{module.label}</h4>
                  <button
                    type="button"
                    onClick={() => toggleModule(module)}
                    className="text-[10px] font-semibold text-brand hover:underline"
                  >
                    {grantedCount === codes.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {module.actions.map((action) => {
                    const active = selected.has(action.code);
                    return (
                      <button
                        key={action.code}
                        type="button"
                        onClick={() => toggle(action.code)}
                        aria-pressed={active}
                        className={cn(
                          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                          active
                            ? 'border-brand bg-brand text-white'
                            : 'border-line bg-white text-ink-2 hover:border-ink-4/60',
                        )}
                      >
                        {active ? <Icons.Check size={11} strokeWidth={2.5} /> : null}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
