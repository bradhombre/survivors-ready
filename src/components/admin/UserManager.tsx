import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ShieldAlert, Trash2, UserPlus, UserCog } from 'lucide-react';
import { toast } from 'sonner';

type SiteUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
};

/**
 * Sitewide accounts, for the site owner only (lives on /admin).
 * "Site admin" is the old platform-wide `admin` role in user_roles, left over from the original
 * single-league app. Since the 9/26 lockdown it grants nothing (admin-users and make_super_admin
 * require the super admin), so it can only be removed here, never granted.
 * League commissioners are managed per league on the League tab.
 */
export function UserManager() {
  const [users, setUsers] = useState<SiteUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'listUsers' },
      });
      if (!error && data?.data) setUsers(data.data);
    } catch {
      // Not allowed: leave the list empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? users.filter((u) => (u.email || '').toLowerCase().includes(q)) : users;
    return [...list].sort((a, b) => (a.role === b.role ? (a.email || '').localeCompare(b.email || '') : a.role === 'admin' ? -1 : 1));
  }, [users, query]);

  const siteAdminCount = users.filter((u) => u.role === 'admin').length;

  const createUser = async () => {
    if (!newEmail || !newPassword) {
      toast.error('Enter an email and a password');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'createUser', email: newEmail, password: newPassword },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error.message ?? 'Could not create the account');
      toast.success(`Account created: ${newEmail}`);
      setNewEmail('');
      setNewPassword('');
      loadUsers();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  const removeSiteAdmin = async (user: SiteUser) => {
    if (!confirm(`Remove the old site admin role from ${user.email}?\n\nThis doesn't affect any league they play in or run.`)) return;
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'removeAdminRole', userId: user.id },
    });
    if (error || data?.error) {
      toast.error(error?.message ?? data?.error?.message ?? 'Could not remove the role');
      return;
    }
    toast.success(`${user.email} is no longer a site admin`);
    loadUsers();
  };

  const deleteUser = async (user: SiteUser) => {
    if (!confirm(`Delete the account ${user.email}?\n\nThis removes their login for good. It cannot be undone.`)) return;
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'deleteUser', userId: user.id },
    });
    if (error || data?.error) {
      toast.error(error?.message ?? data?.error?.message ?? 'Could not delete the account');
    } else {
      toast.success('Account deleted');
      loadUsers();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-muted-foreground" />
            All accounts
          </CardTitle>
          <CardDescription>
            Every account on Survivors Ready. Only you can see this page. "Site admin" is an old role from the first version of the app; it no longer grants anything, so remove it from anyone who has it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by email"
                aria-label="Search accounts by email"
                className="pl-9"
              />
            </div>
            <span className="label-caps text-muted-foreground tabular">
              {users.length} accounts · {siteAdminCount} site admin{siteAdminCount === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading accounts…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts match.</p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-3 min-h-[44px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold truncate">{user.email}</span>
                    {user.role === 'admin' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground">
                        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                        Site admin
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {user.role === 'admin' && (
                      <Button size="sm" variant="outline" className="h-10" onClick={() => removeSiteAdmin(user)}>
                        Remove site admin
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 w-10 p-0 text-destructive hover:text-destructive"
                      aria-label={`Delete ${user.email}`}
                      onClick={() => deleteUser(user)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-muted-foreground" />
            Create an account
          </CardTitle>
          <CardDescription>Rarely needed. People can sign up on their own from the sign-in page.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input placeholder="Email" aria-label="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Input
              type="password"
              placeholder="Password"
              aria-label="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button onClick={createUser} disabled={creating}>
              {creating ? 'Creating…' : 'Create account'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
