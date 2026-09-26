import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { getProxiedImageUrl } from '@/lib/imageProxy';
import { AVATAR_THEMES, getAvatarTheme } from '@/lib/avatarUtils';

interface ContestantAvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'xs' | 'sm' | 'md';
  isEliminated?: boolean;
  className?: string;
}

const sizeClasses = {
  xs: 'h-6 w-6 text-[10px] border-[1.5px]',
  sm: 'h-8 w-8 text-xs border-2',
  md: 'h-10 w-10 text-sm border-2',
};

// Deep Jungle fallback tones (tokens only): canopy, fern, clay, sun, lichen
const FALLBACK_TONES = [
  'bg-[hsl(var(--header-bg))] text-[hsl(var(--header-fg))]',
  'bg-success text-success-foreground',
  'bg-accent text-accent-foreground',
  'bg-warning text-warning-foreground',
  'bg-muted-foreground text-background',
];

export function ContestantAvatar({
  name,
  imageUrl,
  size = 'sm',
  isEliminated = false,
  className,
}: ContestantAvatarProps) {
  const initial = name.charAt(0).toUpperCase();
  const proxiedUrl = getProxiedImageUrl(imageUrl);
  const tone = FALLBACK_TONES[AVATAR_THEMES.indexOf(getAvatarTheme(name)) % FALLBACK_TONES.length];

  return (
    <Avatar
      className={cn(
        'border-plank',
        sizeClasses[size],
        isEliminated && 'grayscale opacity-60',
        className
      )}
    >
      {proxiedUrl && <AvatarImage src={proxiedUrl} alt={name} className="object-cover" />}
      <AvatarFallback className={cn('font-extrabold', tone)}>
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
