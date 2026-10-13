import { supabase } from "@/integrations/supabase/client";

/**
 * Rename a team and everything that refers to it by name (the draft order and which castaways the
 * team owns). Castaways are linked to teams by name, so renaming only the team row leaves its
 * castaways behind under the old name: the team shows 0 points and no active players.
 */
export async function renameTeamEverywhere(leagueId: string, teamId: string, oldName: string, newName: string) {
  if (!newName.trim() || oldName === newName) return;
  const { error } = await supabase.rpc("rename_team_everywhere" as any, {
    _league_id: leagueId,
    _team_id: teamId,
    _old_name: oldName,
    _new_name: newName,
  });
  if (error) throw error;
}
