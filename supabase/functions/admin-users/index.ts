import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    // Get the user from the request
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) {
      console.error('User auth error:', userError)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Only the platform super admin (site owner) may list, create, delete or promote accounts.
    // The old user_roles 'admin' role no longer unlocks this function: it could be handed out
    // from a league's Admin tab by mistake and would expose every account's email.
    const { data: isSuperAdmin } = await supabaseAdmin.rpc('is_super_admin', { _user_id: user.id })

    if (!isSuperAdmin) {
      console.error('User is not admin')
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { action, ...params } = await req.json()
    console.log('Admin action:', action, params)

    let result

    switch (action) {
      case 'createUser':
        result = await supabaseAdmin.auth.admin.createUser({
          email: params.email,
          password: params.password,
          email_confirm: true,
        })
        break

      case 'deleteUser':
        result = await supabaseAdmin.auth.admin.deleteUser(params.userId)
        break

      case 'listUsers':
        const { data: profiles } = await supabaseAdmin
          .from('profiles')
          .select('id, email')
        
        if (profiles) {
          const usersWithRoles = await Promise.all(
            profiles.map(async (profile) => {
              const { data: roleData } = await supabaseAdmin
                .from('user_roles')
                .select('role')
                .eq('user_id', profile.id)
                .single()

              return {
                id: profile.id,
                email: profile.email,
                role: roleData?.role || 'user',
              }
            })
          )
          result = { data: usersWithRoles, error: null }
        } else {
          result = { data: [], error: null }
        }
        break

      case 'addAdminRole':
        result = await supabaseAdmin
          .from('user_roles')
          .insert({ user_id: params.userId, role: 'admin' })
        break

      case 'removeAdminRole':
        result = await supabaseAdmin
          .from('user_roles')
          .delete()
          .eq('user_id', params.userId)
          .eq('role', 'admin')
        break

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    console.log('Result:', result)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})