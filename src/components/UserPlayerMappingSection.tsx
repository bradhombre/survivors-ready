import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PLAYERS, Player } from '@/types/survivor';
import { Badge } from '@/components/ui/badge';

type UserWithRole = {
  id: string;
  email: string;
  role: 'admin' | 'user';
};

type UserMapping = {
  id: string;
  user_id: string;
  player_name: string;
};

interface UserPlayerMappingSectionProps {
  users: UserWithRole[];
  onMappingUpdate?: () => void;
}

export function UserPlayerMappingSection({ users, onMappingUpdate }: UserPlayerMappingSectionProps) {
  const [mappings, setMappings] = useState<UserMapping[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | ''>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadMappings();
  }, []);

  const loadMappings = async () => {
    const { data, error } = await supabase
      .from('user_player_mapping')
      .select('*');

    if (!error && data) {
      setMappings(data);
    }
  };

  const assignPlayer = async () => {
    if (!selectedUser || !selectedPlayer) {
      toast.error('Please select both a user and a player');
      return;
    }

    setIsLoading(true);
    try {
      // Check if user already has a mapping
      const existingMapping = mappings.find(m => m.user_id === selectedUser);
      
      if (existingMapping) {
        // Update existing mapping
        const { error } = await supabase
          .from('user_player_mapping')
          .update({ player_name: selectedPlayer })
          .eq('user_id', selectedUser);

        if (error) throw error;
      } else {
        // Insert new mapping
        const { error } = await supabase
          .from('user_player_mapping')
          .insert({ user_id: selectedUser, player_name: selectedPlayer });

        if (error) throw error;
      }

      toast.success('Player assignment updated');
      setSelectedUser('');
      setSelectedPlayer('');
      loadMappings();
      onMappingUpdate?.();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteMapping = async (userId: string) => {
    const { error } = await supabase
      .from('user_player_mapping')
      .delete()
      .eq('user_id', userId);

    if (error) {
      toast.error('Failed to delete mapping');
    } else {
      toast.success('Mapping deleted');
      loadMappings();
      onMappingUpdate?.();
    }
  };

  const getUserEmail = (userId: string) => {
    return users.find(u => u.id === userId)?.email || 'Unknown';
  };

  const assignedPlayers = new Set(mappings.map(m => m.player_name));
  const availablePlayers = PLAYERS.filter(p => !assignedPlayers.has(p) || mappings.find(m => m.player_name === p)?.user_id === selectedUser);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={selectedUser} onValueChange={setSelectedUser}>
          <SelectTrigger className="flex-1 h-11 rounded-[10px] border-2 bg-card font-bold">
            <SelectValue placeholder="Select user" />
          </SelectTrigger>
          <SelectContent>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedPlayer} onValueChange={(value) => setSelectedPlayer(value as Player)}>
          <SelectTrigger className="flex-1 h-11 rounded-[10px] border-2 bg-card font-bold">
            <SelectValue placeholder="Select player" />
          </SelectTrigger>
          <SelectContent>
            {availablePlayers.map((player) => (
              <SelectItem key={player} value={player}>
                {player}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={assignPlayer} disabled={isLoading || !selectedUser || !selectedPlayer}>
          Assign
        </Button>
      </div>

      <div className="space-y-2">
        {mappings.map((mapping) => (
          <div
            key={mapping.id}
            className="glass rounded-[12px] flex min-h-[44px] items-center justify-between gap-3 p-3"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold">{getUserEmail(mapping.user_id)}</span>
              <Badge variant="default">{mapping.player_name}</Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => deleteMapping(mapping.user_id)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      {mappings.length === 0 && (
        <p className="glass rounded-[12px] text-sm text-muted-foreground text-center px-4 py-6">
          No player assignments yet. Assign users to players above.
        </p>
      )}
    </div>
  );
}
