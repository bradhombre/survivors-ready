import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Save, Scale, Trash2, ChevronDown, RotateCcw, Plus, Bookmark, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { SCORING_ACTIONS } from "@/types/survivor";
import { Switch } from "@/components/ui/switch";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { Badge } from "@/components/ui/badge";
import { 
  CustomScoringAction, 
  getCustomActions, 
  SCORING_TEMPLATES,
  applyTemplate,
} from "@/lib/scoring";

const SCORING_CATEGORIES = {
  "Idols & Advantages": ["FIND_IDOL", "ACQUIRE_IDOL", "FIND_ADVANTAGE", "ACQUIRE_ADVANTAGE", "VOTED_OUT_WITH_IDOL"],
  "Challenges": ["WIN_IMMUNITY", "CATCH_TOSS", "DROP_TOSS"],
  "Tribal & Survival": ["TRIBAL_VOTE_CORRECT", "SURVIVE_PRE", "SURVIVE_POST", "VOTED_OUT", "QUIT"],
  "Milestones": ["MAKE_JURY", "MAKE_FINAL", "WIN_SURVIVOR"],
  "Miscellaneous": ["CRY", "EPISODE_TITLE", "MISC_25", "MISC_50", "MISC_NEG_10", "MISC_NEG_25"],
};

interface ScoringSettingsProps {
  leagueId: string;
  onScoringConfigSaved?: (config: ScoringConfig) => void;
}

interface SavedTemplate {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  config: ScoringConfig;
  created_at: string;
}

type ScoringConfig = Record<string, number | null | CustomScoringAction[]>;

const getDefaultScoringConfig = (): ScoringConfig => {
  const config: ScoringConfig = {};
  Object.entries(SCORING_ACTIONS).forEach(([key, value]) => {
    config[key] = value.points;
  });
  return config;
};

const isActionEnabled = (key: string, config: ScoringConfig): boolean => {
  return config[key] !== null;
};

const generateCustomActionId = () => `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export function ScoringSettings({ leagueId, onScoringConfigSaved }: ScoringSettingsProps) {
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig>(getDefaultScoringConfig());
  const [loading, setLoading] = useState(true);
  const [savingScoring, setSavingScoring] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [allowPlayerScoring, setAllowPlayerScoring] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<Record<string, number> | null>(null);
  
  const [customActions, setCustomActions] = useState<CustomScoringAction[]>([]);
  const [newActionLabel, setNewActionLabel] = useState("");
  const [newActionEmoji, setNewActionEmoji] = useState("⭐");
  const [newActionPoints, setNewActionPoints] = useState(10);
  
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [newTemplateEmoji, setNewTemplateEmoji] = useState("⭐");
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }

      const { data: leagueData, error: leagueError } = await supabase
        .from("leagues")
        .select("owner_id, scoring_config, allow_player_scoring")
        .eq("id", leagueId)
        .single();

      if (leagueError) {
        toast.error("Failed to load scoring settings");
        setLoading(false);
        return;
      }

      setIsOwner(user?.id === leagueData.owner_id);
      setAllowPlayerScoring(!!leagueData.allow_player_scoring);
      setOriginalConfig(leagueData.scoring_config as Record<string, number> | null);
      
      if (leagueData.scoring_config) {
        const savedConfig = leagueData.scoring_config as ScoringConfig;
        const mergedConfig = { ...getDefaultScoringConfig(), ...savedConfig };
        setScoringConfig(mergedConfig);
        const loadedCustomActions = getCustomActions(savedConfig);
        setCustomActions(loadedCustomActions);
      }

      const { data: templatesData } = await supabase
        .from("scoring_templates")
        .select("id, name, description, emoji, config, created_at")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false });
      
      if (templatesData) {
        setSavedTemplates(templatesData as SavedTemplate[]);
      }

      setLoading(false);
    };

    fetchData();
  }, [leagueId]);

  const handleSaveScoringConfig = async () => {
    setSavingScoring(true);
    const configToSave: Record<string, unknown> = {
      ...scoringConfig,
      custom_actions: customActions,
    };
    const { error } = await supabase
      .from("leagues")
      .update({ scoring_config: configToSave as Record<string, number> })
      .eq("id", leagueId);

    if (error) {
      toast.error("Failed to save scoring rules");
    } else {
      toast.success("Scoring rules saved");
      setOriginalConfig(configToSave as Record<string, number>);
      onScoringConfigSaved?.(configToSave as ScoringConfig);
    }
    setSavingScoring(false);
  };

  const handleScoringChange = (key: string, value: number) => {
    setScoringConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleScoringToggle = (key: string, enabled: boolean) => {
    if (enabled) {
      const defaultPoints = SCORING_ACTIONS[key as keyof typeof SCORING_ACTIONS]?.points ?? 0;
      setScoringConfig(prev => ({ ...prev, [key]: defaultPoints }));
    } else {
      setScoringConfig(prev => ({ ...prev, [key]: null }));
    }
  };

  const handleResetToDefaults = () => {
    setScoringConfig(getDefaultScoringConfig());
    setCustomActions([]);
    toast.success("Scoring rules reset to defaults (save to apply)");
  };

  const hasUnsavedScoringChanges = () => {
    const savedConfig = originalConfig || {};
    const defaults = getDefaultScoringConfig();
    
    const defaultsChanged = Object.keys(SCORING_ACTIONS).some(key => {
      const currentValue = scoringConfig[key];
      const savedValue = (savedConfig as Record<string, number>)[key] ?? defaults[key];
      return currentValue !== savedValue;
    });
    
    const savedCustomActions = getCustomActions(savedConfig as ScoringConfig);
    const customActionsChanged = JSON.stringify(customActions) !== JSON.stringify(savedCustomActions);
    
    return defaultsChanged || customActionsChanged;
  };

  const handleAddCustomAction = () => {
    if (!newActionLabel.trim()) {
      toast.error("Please enter a label for the action");
      return;
    }
    
    const allLabels = [
      ...Object.values(SCORING_ACTIONS).map(a => a.label.toLowerCase()),
      ...customActions.map(a => a.label.toLowerCase()),
    ];
    if (allLabels.includes(newActionLabel.trim().toLowerCase())) {
      toast.error("An action with this label already exists");
      return;
    }
    
    const newAction: CustomScoringAction = {
      id: generateCustomActionId(),
      label: newActionLabel.trim(),
      emoji: newActionEmoji,
      points: newActionPoints,
    };
    
    setCustomActions(prev => [...prev, newAction]);
    setNewActionLabel("");
    setNewActionEmoji("⭐");
    setNewActionPoints(10);
    toast.success("Custom action added (save to apply)");
  };

  const handleUpdateCustomAction = (actionId: string, updates: Partial<CustomScoringAction>) => {
    setCustomActions(prev => prev.map(a => 
      a.id === actionId ? { ...a, ...updates } : a
    ));
  };

  const handleDeleteCustomAction = (actionId: string) => {
    setCustomActions(prev => prev.filter(a => a.id !== actionId));
    toast.success("Custom action removed (save to apply)");
  };

  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    if (!currentUserId) return;
    
    setSavingTemplate(true);
    
    const configToSave = {
      ...scoringConfig,
      custom_actions: customActions,
    };
    
    const { data, error } = await supabase
      .from("scoring_templates")
      .insert({
        league_id: leagueId,
        name: newTemplateName.trim(),
        description: newTemplateDescription.trim() || null,
        emoji: newTemplateEmoji,
        config: configToSave,
        created_by: currentUserId,
      } as any)
      .select()
      .single();
    
    if (error) {
      toast.error("Failed to save template");
    } else {
      toast.success(`Template "${newTemplateName}" saved`);
      setSavedTemplates(prev => [data as SavedTemplate, ...prev]);
      setSaveTemplateDialogOpen(false);
      setNewTemplateName("");
      setNewTemplateDescription("");
      setNewTemplateEmoji("⭐");
    }
    
    setSavingTemplate(false);
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    const { error } = await supabase
      .from("scoring_templates")
      .delete()
      .eq("id", templateId);
    
    if (error) {
      toast.error("Failed to delete template");
    } else {
      toast.success(`Template "${templateName}" deleted`);
      setSavedTemplates(prev => prev.filter(t => t.id !== templateId));
    }
  };

  const handleApplySavedTemplate = (template: SavedTemplate) => {
    const config = template.config as ScoringConfig;
    const mergedConfig = { ...getDefaultScoringConfig(), ...config };
    setScoringConfig(mergedConfig);
    const loadedCustomActions = getCustomActions(config);
    setCustomActions(loadedCustomActions);
    toast.success(`Applied "${template.name}" template`);
  };

  const handleTogglePlayerScoring = async (value: boolean) => {
    setAllowPlayerScoring(value);
    const { error } = await supabase
      .from("leagues")
      .update({ allow_player_scoring: value })
      .eq("id", leagueId);
    if (error) {
      setAllowPlayerScoring(!value);
      toast.error("Failed to update scoring permissions");
    } else {
      toast.success(value ? "All players can now score episodes" : "Only commissioners can score now");
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Loading scoring settings...</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 shrink-0 text-muted-foreground" />
          Scoring rules
        </CardTitle>
        <CardDescription>
          Apply a template or customize individual point values
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {/* Who can score */}
          <div className="glass rounded-[12px] flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-bold">Let all players score episodes</p>
              <p className="text-xs text-muted-foreground">
                When off, only commissioners can add points. Turn on for casual leagues where anyone watching can record scores. Voted Out stays commissioner-only.
              </p>
            </div>
            <Switch
              checked={allowPlayerScoring}
              onCheckedChange={handleTogglePlayerScoring}
              disabled={!isOwner}
              aria-label="Let all players score episodes"
            />
          </div>
          {/* Scoring Templates */}
          {isOwner && (
            <div className="space-y-4 pb-5 border-b border-border">
              {/* Predefined Templates */}
              <div className="space-y-2">
                <p className="label-caps text-muted-foreground">Predefined templates</p>
                <div className="flex flex-wrap gap-2">
                  {SCORING_TEMPLATES.map((template) => (
                    <AlertDialog key={template.id}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          className="glass h-11 rounded-full px-4 gap-2 hover:bg-muted"
                        >
                          <span className="text-base leading-none" aria-hidden="true">{template.emoji}</span>
                          <span className="text-sm font-bold">{template.name}</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <span className="text-2xl" aria-hidden="true">{template.emoji}</span>
                            Apply "{template.name}" template
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {template.description}. This will replace your current scoring configuration.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="max-h-64 overflow-y-auto space-y-3 my-4 text-sm">
                          {(() => {
                            const enabledCount = Object.values(template.config).filter(v => v !== null).length;
                            const totalCount = Object.keys(SCORING_ACTIONS).length;
                            return (
                              <div className="flex items-center gap-2 pb-2 border-b border-border">
                                <Badge variant={enabledCount === totalCount ? "default" : "secondary"} className="tabular">
                                  {enabledCount} of {totalCount} actions enabled
                                </Badge>
                              </div>
                            );
                          })()}
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              const newConfig = applyTemplate(template.id, scoringConfig);
                              setScoringConfig(newConfig);
                              const existingCustom = getCustomActions(scoringConfig);
                              setCustomActions(existingCustom);
                              toast.success(`Applied "${template.name}" template`);
                            }}
                          >
                            Apply template
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ))}
                </div>
              </div>

              {/* Saved Templates */}
              {savedTemplates.length > 0 && (
                <div className="space-y-3">
                  <p className="label-caps text-muted-foreground flex items-center gap-1.5">
                    <Bookmark className="h-3.5 w-3.5" />
                    Your saved templates
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {savedTemplates.map((template) => (
                      <div key={template.id} className="relative group">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              className="glass h-11 max-w-[16rem] rounded-full px-4 gap-2 hover:bg-muted"
                            >
                              <span className="text-base leading-none" aria-hidden="true">{template.emoji}</span>
                              <span className="text-sm font-bold truncate">{template.name}</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <span className="text-2xl" aria-hidden="true">{template.emoji}</span>
                                Apply "{template.name}"
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {template.description || "Your saved template"}. This will replace your current scoring configuration.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleApplySavedTemplate(template)}>
                                Apply template
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute -top-2 -right-2 h-8 w-8 sm:h-6 sm:w-6 rounded-full border-2 border-plank bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                              aria-label={`Delete template ${template.name}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete template</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{template.name}"? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteTemplate(template.id, template.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save Current Config as Template */}
              <Dialog open={saveTemplateDialogOpen} onOpenChange={setSaveTemplateDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Bookmark className="h-4 w-4" />
                    Save current as template
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save scoring template</DialogTitle>
                    <DialogDescription>
                      Save your current scoring configuration as a template to reuse in future seasons.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="flex items-center gap-3">
                      <EmojiPicker value={newTemplateEmoji} onChange={setNewTemplateEmoji} />
                      <Input
                        placeholder="Template name"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                    <Input
                      placeholder="Description (optional)"
                      value={newTemplateDescription}
                      onChange={(e) => setNewTemplateDescription(e.target.value)}
                    />
                    <div className="text-sm text-muted-foreground">
                      {(() => {
                        const enabledCount = Object.entries(scoringConfig).filter(([k, v]) => v !== null && k !== 'custom_actions').length;
                        return `This will save ${enabledCount} enabled actions and ${customActions.length} custom action(s).`;
                      })()}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveTemplateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveAsTemplate} disabled={savingTemplate || !newTemplateName.trim()}>
                      {savingTemplate ? "Saving..." : "Save template"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <TooltipProvider>
            {Object.entries(SCORING_CATEGORIES).map(([category, actionKeys]) => (
              <Collapsible key={category} defaultOpen>
                <CollapsibleTrigger className="flex min-h-[44px] w-full items-center justify-between border-b-2 border-plank py-2 text-left transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
                  <span className="label-caps text-muted-foreground">{category}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-border">
                    {actionKeys.map((key) => {
                      const action = SCORING_ACTIONS[key as keyof typeof SCORING_ACTIONS];
                      if (!action) return null;
                      const enabled = isActionEnabled(key, scoringConfig);
                      
                      return (
                        <div 
                          key={key} 
                          className={`flex min-h-[52px] items-center justify-between gap-3 py-2 transition-opacity ${
                            !enabled ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {isOwner && (
                              <Switch
                                checked={enabled}
                                onCheckedChange={(checked) => handleScoringToggle(key, checked)}
                              />
                            )}
                            <span className="text-base leading-none" aria-hidden="true">{action.emoji}</span>
                            <span className={`text-sm font-bold ${!enabled ? 'line-through text-muted-foreground' : ''}`}>
                              {action.label.replace(` ${action.emoji}`, '')}
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p>{action.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {enabled ? (
                              <>
                                <Input
                                  type="number"
                                  value={typeof scoringConfig[key] === 'number' ? scoringConfig[key] : action.points}
                                  onChange={(e) => handleScoringChange(key, parseInt(e.target.value) || 0)}
                                  className="w-20 h-10 text-right font-extrabold tabular"
                                  disabled={!isOwner}
                                />
                                <span className="label-caps text-muted-foreground w-7">pts</span>
                              </>
                            ) : (
                              <span className="label-caps text-muted-foreground">Disabled</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </TooltipProvider>

          {/* Custom Scoring Rules Section */}
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex min-h-[44px] w-full items-center justify-between border-b-2 border-plank py-2 text-left transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
              <span className="label-caps text-muted-foreground">Custom scoring rules</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border">
                {customActions.length === 0 && !isOwner && (
                  <p className="text-sm text-muted-foreground py-2">No custom scoring rules defined.</p>
                )}
                
                {customActions.map((action) => (
                  <div 
                    key={action.id} 
                    className="flex min-h-[52px] items-center justify-between gap-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-3 flex-1">
                      <EmojiPicker
                        value={action.emoji}
                        onChange={(emoji) => handleUpdateCustomAction(action.id, { emoji })}
                        disabled={!isOwner}
                      />
                      <Input
                        value={action.label}
                        onChange={(e) => handleUpdateCustomAction(action.id, { label: e.target.value })}
                        className="flex-1 h-10 font-bold"
                        disabled={!isOwner}
                        placeholder="Action label"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Input
                        type="number"
                        value={action.points}
                        onChange={(e) => handleUpdateCustomAction(action.id, { points: parseInt(e.target.value) || 0 })}
                        className="w-20 h-10 text-right font-extrabold tabular"
                        disabled={!isOwner}
                      />
                      <span className="label-caps text-muted-foreground w-7">pts</span>
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteCustomAction(action.id)}
                          aria-label={`Remove ${action.label}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                
                {isOwner && (
                  <div className="pt-4">
                    <p className="label-caps text-muted-foreground mb-2">Add custom action</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <EmojiPicker
                        value={newActionEmoji}
                        onChange={setNewActionEmoji}
                      />
                      <Input
                        value={newActionLabel}
                        onChange={(e) => setNewActionLabel(e.target.value)}
                        className="flex-1 min-w-[150px]"
                        placeholder="Action label (e.g., Wins Reward)"
                      />
                      <Input
                        type="number"
                        value={newActionPoints}
                        onChange={(e) => setNewActionPoints(parseInt(e.target.value) || 0)}
                        className="w-20 text-right font-extrabold tabular"
                      />
                      <span className="label-caps text-muted-foreground">pts</span>
                      <Button
                        onClick={handleAddCustomAction}
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
          
          {isOwner && (
            <div className="flex flex-wrap justify-between items-center gap-3 pt-4 border-t-2 border-plank">
              <Button 
                variant="outline"
                onClick={handleResetToDefaults}
              >
                <RotateCcw className="h-4 w-4" />
                Reset to defaults
              </Button>
              <Button 
                onClick={handleSaveScoringConfig} 
                disabled={savingScoring || !hasUnsavedScoringChanges()}
              >
                <Save className="h-4 w-4" />
                {savingScoring ? "Saving..." : "Save scoring rules"}
              </Button>
            </div>
          )}
          {!isOwner && (
            <p className="text-sm text-muted-foreground">
              Only the league owner can edit scoring rules.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
