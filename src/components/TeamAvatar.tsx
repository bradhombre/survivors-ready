import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { AVATAR_THEMES, getAvatarTheme, getInitials } from '@/lib/avatarUtils';

interface TeamAvatarProps {
  teamName: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  useIcon?: boolean;
  className?: string;
}

const sizeClasses = {
  xs: 'h-6 w-6 text-xs border-[1.5px]',
  sm: 'h-8 w-8 text-sm border-2',
  md: 'h-10 w-10 text-base border-2',
  lg: 'h-16 w-16 text-xl border-2',
  xl: 'h-20 w-20 text-2xl border-2',
};

// Deep Jungle fallback tones (tokens only): canopy, fern, clay, sun, lichen
const FALLBACK_TONES = [
  'bg-[hsl(var(--header-bg))] text-[hsl(var(--header-fg))]',
  'bg-success text-success-foreground',
  'bg-accent text-accent-foreground',
  'bg-warning text-warning-foreground',
  'bg-muted-foreground text-background',
];

export function TeamAvatar({ 
  teamName, 
  avatarUrl, 
  size = 'md', 
  useIcon = false,
  className 
}: TeamAvatarProps) {
  const theme = getAvatarTheme(teamName);
  const content = useIcon ? theme.icon : getInitials(teamName);
  const tone = FALLBACK_TONES[AVATAR_THEMES.indexOf(theme) % FALLBACK_TONES.length];

  return (
    <Avatar className={cn('border-plank', sizeClasses[size], className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={teamName} className="object-cover" />}
      <AvatarFallback 
        className={cn(
          `${tone} font-extrabold`,
          // Only show fallback styling when there's no image
          !avatarUrl && 'flex'
        )}
      >
        {content}
      </AvatarFallback>
    </Avatar>
  );
}
