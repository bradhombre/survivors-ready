import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TeamAvatar } from './TeamAvatar';

interface TeamAvatarUploadProps {
  teamId: string;
  leagueId: string;
  currentAvatarUrl?: string | null;
  teamName: string;
  onUploadComplete: (url: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

export function TeamAvatarUpload({
  teamId,
  leagueId,
  currentAvatarUrl,
  teamName,
  onUploadComplete,
  size = 'md',
}: TeamAvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Map prop sizes to TeamAvatar sizes
  const avatarSizeMap = {
    sm: 'lg' as const,
    md: 'xl' as const,
    lg: 'xl' as const,
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be less than 2MB');
      return;
    }

    setUploading(true);

    try {
      // Generate unique filename
      const ext = file.name.split('.').pop();
      const filePath = `${leagueId}/${teamId}.${ext}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('team-avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('team-avatars')
        .getPublicUrl(filePath);

      // Add cache buster to force refresh
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      // Update team record
      const { error: updateError } = await supabase
        .from('league_teams')
        .update({ avatar_url: publicUrl })
        .eq('id', teamId);

      if (updateError) throw updateError;

      onUploadComplete(publicUrl);
      toast.success('Team photo updated!');
    } catch (err: any) {
      console.error('Upload error:', err);
      toast.error(err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative inline-block">
      <TeamAvatar 
        teamName={teamName} 
        avatarUrl={currentAvatarUrl} 
        size={avatarSizeMap[size]}
        className={size === 'lg' ? 'h-28 w-28' : undefined}
      />
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />
      
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full border-b-2"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        aria-label="Change team photo"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
