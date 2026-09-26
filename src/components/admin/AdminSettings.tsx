import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Settings, Save } from 'lucide-react';
import { toast } from 'sonner';

export function AdminSettings() {
  const [donateUrl, setDonateUrl] = useState('');
  const [currentSeason, setCurrentSeason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['donate_url', 'current_season']);
      data?.forEach((r) => {
        if (r.key === 'donate_url') setDonateUrl(r.value || '');
        if (r.key === 'current_season') setCurrentSeason(r.value || '');
      });
      setLoading(false);
    };
    fetch();
  }, []);

  const handleSave = async () => {
    const seasonNum = parseInt(currentSeason);
    if (!seasonNum || seasonNum < 1) {
      toast.error('Current season must be a number');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('app_settings')
      .upsert([
        { key: 'donate_url', value: donateUrl.trim(), updated_at: now },
        { key: 'current_season', value: String(seasonNum), updated_at: now },
      ]);

    if (error) {
      toast.error('Failed to save settings');
    } else {
      toast.success('Settings saved!');
    }
    setSaving(false);
  };

  if (loading) return <p className="text-muted-foreground p-4">Loading...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-3xl">
          <Settings className="h-5 w-5 text-muted-foreground" />
          App settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 max-w-lg">
          <Label htmlFor="current-season" className="label-caps text-muted-foreground">Current season</Label>
          <Input
            id="current-season"
            type="number"
            min={1}
            className="w-32 tabular"
            value={currentSeason}
            onChange={(e) => setCurrentSeason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            New leagues default to this season. A weekly check imports its cast from the wiki if none exists yet.
          </p>
        </div>
        <div className="space-y-2 max-w-lg">
          <Label htmlFor="donate-url" className="label-caps text-muted-foreground">Donate / Buy Me a Coffee URL</Label>
          <Input
            id="donate-url"
            placeholder="https://buymeacoffee.com/yourname"
            value={donateUrl}
            onChange={(e) => setDonateUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to hide the donate button throughout the app.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  );
}
