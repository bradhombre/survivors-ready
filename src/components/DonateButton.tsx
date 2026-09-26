import { useAppSettings } from '@/hooks/useAppSettings';
import { Button } from '@/components/ui/button';
import { Heart } from 'lucide-react';

export function DonateButton() {
  const { settings, loading } = useAppSettings();
  const donateUrl = settings['donate_url'];

  if (loading || !donateUrl) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
      asChild
    >
      <a href={donateUrl} target="_blank" rel="noopener noreferrer">
        <Heart className="h-3 w-3" aria-hidden="true" />
        Buy me a coffee
      </a>
    </Button>
  );
}
