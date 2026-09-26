-- Site admin lockdown (2026-09-26)
-- The old user_roles 'admin' role (from the original single-league app) used to be grantable from
-- any league's Admin tab ("Make admin"). Holders could list every account's email, create/delete
-- accounts, mint more admins, and even promote themselves to platform super admin.
-- After this migration only the platform super admin (the site owner) can do any of that.
-- Safe to run more than once. Changes no rows.

-- 1) Only an existing super admin can create another super admin.
CREATE OR REPLACE FUNCTION public.make_super_admin(user_uuid UUID)
RETURNS public.league_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_membership public.league_memberships;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the site owner can create super admins';
  END IF;

  INSERT INTO public.league_memberships (league_id, user_id, role)
  VALUES (NULL, user_uuid, 'super_admin')
  ON CONFLICT DO NOTHING
  RETURNING * INTO new_membership;

  RETURN new_membership;
END;
$$;

-- 2) 'admin' holders can no longer hand out or strip roles from the browser.
--    (The admin-users edge function uses the service role, so the site owner's
--    Accounts tab keeps working.)
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
