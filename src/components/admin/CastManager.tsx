import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Plus, Upload, Trash2, Pencil, Check, X, Users, FileUp, AlertTriangle, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAppSettings } from "@/hooks/useAppSettings";

interface MasterContestant {
  id: string;
  season_number: number;
  name: string;
  image_url: string | null;
  tribe: string | null;
  age: number | null;
  occupation: string | null;
  created_at: string;
}

interface ParsedContestant {
  name: string;
  tribe: string | null;
  age: number | null;
  occupation: string | null;
  image_url: string | null;
}

interface ColumnMapping {
  name?: number;
  tribe?: number;
  age?: number;
  occupation?: number;
  image_url?: number;
}

type ColumnType = 'name' | 'tribe' | 'age' | 'occupation' | 'image_url';

// Normalize column name for matching
function normalizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[_\s]+/g, " ") // Normalize underscores and whitespace to single space
    .trim();
}

// Smart header detection with flexible matching
function detectColumnType(header: string): ColumnType | null {
  const h = normalizeColumnName(header);
  
  // Exact matches first
  const exactMatches: Record<string, ColumnType> = {
    'name': 'name',
    'contestant': 'name',
    'player': 'name',
    'castaway': 'name',
    'full name': 'name',
    'contestant name': 'name',
    'tribe': 'tribe',
    'team': 'tribe',
    'starting tribe': 'tribe',
    'starting tribe name': 'tribe',
    'original tribe': 'tribe',
    'age': 'age',
    'occupation': 'occupation',
    'job': 'occupation',
    'profession': 'occupation',
    'career': 'occupation',
    'location': 'occupation', // Map location to occupation field as fallback
    'hometown': 'occupation',
    'image': 'image_url',
    'image url': 'image_url',
    'photo': 'image_url',
    'headshot': 'image_url',
    'picture': 'image_url',
    'url': 'image_url',
    'img': 'image_url',
    'photo url': 'image_url',
    'pic': 'image_url',
  };
  
  if (exactMatches[h]) return exactMatches[h];
  
  // Partial/contains matching for common patterns
  if (h.includes('name') && !h.includes('tribe')) return 'name';
  if (h.includes('tribe') || h.includes('team')) return 'tribe';
  if (h.includes('age')) return 'age';
  if (h.includes('occupation') || h.includes('job') || h.includes('profession')) return 'occupation';
  if (h.includes('location') || h.includes('hometown') || h.includes('from')) return 'occupation';
  if (h.includes('image') || h.includes('photo') || h.includes('headshot') || h.includes('pic')) return 'image_url';
  
  return null;
}

// Build column mapping from headers
function buildColumnMapping(headers: string[]): { mapping: ColumnMapping; hasHeaders: boolean } {
  const mapping: ColumnMapping = {};
  let matchedColumns = 0;
  
  headers.forEach((header, index) => {
    const type = detectColumnType(header);
    if (type && !(type in mapping)) {
      mapping[type] = index;
      matchedColumns++;
    }
  });
  
  // If we matched at least 1 column with name, consider it as having headers
  const hasHeaders = matchedColumns > 0 && 'name' in mapping;
  
  return { mapping, hasHeaders };
}

// Fallback positional mapping
function getPositionalMapping(): ColumnMapping {
  return {
    name: 0,
    tribe: 1,
    age: 2,
    occupation: 3,
    image_url: 4,
  };
}

// Parse CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

// Parse a row using the column mapping
function parseRowWithMapping(parts: string[], mapping: ColumnMapping): ParsedContestant | null {
  const name = mapping.name !== undefined ? parts[mapping.name]?.trim() : '';
  if (!name) return null;
  
  const ageStr = mapping.age !== undefined ? parts[mapping.age]?.trim() : '';
  const age = ageStr ? parseInt(ageStr) : null;
  
  return {
    name,
    tribe: mapping.tribe !== undefined ? parts[mapping.tribe]?.trim() || null : null,
    age: age && !isNaN(age) ? age : null,
    occupation: mapping.occupation !== undefined ? parts[mapping.occupation]?.trim() || null : null,
    image_url: mapping.image_url !== undefined ? parts[mapping.image_url]?.trim() || null : null,
  };
}

export function CastManager() {
  const [season, setSeason] = useState(51);
  const [isWikiImporting, setIsWikiImporting] = useState(false);
  const { settings: appSettings } = useAppSettings();
  useEffect(() => {
    const cur = parseInt(appSettings.current_season || "");
    if (cur) setSeason(cur);
  }, [appSettings.current_season]);
  const [contestants, setContestants] = useState<MasterContestant[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingSeasons, setExistingSeasons] = useState<number[]>([]);

  // Add/Edit state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    tribe: "",
    age: "",
    occupation: "",
    image_url: "",
  });
  const [bulkText, setBulkText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // CSV Preview state
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewData, setPreviewData] = useState<ParsedContestant[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [hasDetectedHeaders, setHasDetectedHeaders] = useState(true);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);

  // Delete All state
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch Images state
  const [showFetchImagesDialog, setShowFetchImagesDialog] = useState(false);
  const [isFetchingImages, setIsFetchingImages] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0, currentName: "" });
  const [fetchResults, setFetchResults] = useState<{ found: number; notFound: number; failed: string[] }>({ found: 0, notFound: 0, failed: [] });
  const [fetchingContestantId, setFetchingContestantId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch available seasons
  useEffect(() => {
    const fetchSeasons = async () => {
      const { data } = await supabase
        .from("master_contestants")
        .select("season_number")
        .order("season_number", { ascending: false });

      if (data) {
        const uniqueSeasons = [...new Set(data.map((d) => d.season_number))];
        setExistingSeasons(uniqueSeasons);
      }
    };
    fetchSeasons();
  }, []);

  // Fetch contestants for selected season
  const fetchContestants = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("master_contestants")
      .select("*")
      .eq("season_number", season)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching contestants:", error);
      toast.error("Failed to load cast");
    } else {
      setContestants(data || []);
    }
    setLoading(false);
  }, [season]);

  useEffect(() => {
    fetchContestants();
  }, [fetchContestants]);

  const resetForm = () => {
    setFormData({ name: "", tribe: "", age: "", occupation: "", image_url: "" });
    setEditingId(null);
  };

  const handleAddContestant = async () => {
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.from("master_contestants").insert({
      season_number: season,
      name: formData.name.trim(),
      tribe: formData.tribe.trim() || null,
      age: formData.age ? parseInt(formData.age) : null,
      occupation: formData.occupation.trim() || null,
      image_url: formData.image_url.trim() || null,
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("A contestant with this name already exists for this season");
      } else {
        toast.error("Failed to add contestant");
      }
    } else {
      toast.success(`Added ${formData.name}`);
      resetForm();
      setShowAddDialog(false);
      fetchContestants();
    }
    setIsSaving(false);
  };

  const handleUpdateContestant = async (id: string) => {
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setIsSaving(true);
    const { error } = await supabase
      .from("master_contestants")
      .update({
        name: formData.name.trim(),
        tribe: formData.tribe.trim() || null,
        age: formData.age ? parseInt(formData.age) : null,
        occupation: formData.occupation.trim() || null,
        image_url: formData.image_url.trim() || null,
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update contestant");
    } else {
      toast.success("Contestant updated");
      setEditingId(null);
      fetchContestants();
    }
    setIsSaving(false);
  };

  const handleDeleteContestant = async (id: string, name: string) => {
    const { error } = await supabase
      .from("master_contestants")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete contestant");
    } else {
      toast.success(`Deleted ${name}`);
      fetchContestants();
    }
  };

  const handleDeleteAllSeason = async () => {
    setIsDeleting(true);
    const { error } = await supabase
      .from("master_contestants")
      .delete()
      .eq("season_number", season);

    if (error) {
      toast.error("Failed to delete contestants");
    } else {
      toast.success(`Deleted all ${contestants.length} contestants for Season ${season}`);
      setShowDeleteAllDialog(false);
      fetchContestants();
      // Update existing seasons list
      setExistingSeasons(existingSeasons.filter(s => s !== season));
    }
    setIsDeleting(false);
  };

  // Count contestants missing images
  const missingImagesCount = contestants.filter(c => !c.image_url).length;

  // Fetch images for all contestants missing images
  const handleFetchImages = async (forceRefresh = false) => {
    const contestantsToFetch = forceRefresh 
      ? contestants 
      : contestants.filter(c => !c.image_url);
    
    if (contestantsToFetch.length === 0) {
      toast.info("All contestants already have images");
      return;
    }

    setIsFetchingImages(true);
    setShowFetchImagesDialog(true);
    setFetchProgress({ current: 0, total: contestantsToFetch.length, currentName: "" });
    setFetchResults({ found: 0, notFound: 0, failed: [] });
    
    abortControllerRef.current = new AbortController();

    try {
      const { data, error } = await supabase.functions.invoke("fetch-cast-images", {
        body: {
          season_number: season,
          contestant_ids: contestantsToFetch.map(c => c.id),
          force_refresh: forceRefresh,
        },
      });

      if (error) {
        console.error("Error fetching images:", error);
        toast.error("Failed to fetch images");
        setIsFetchingImages(false);
        return;
      }

      // Update results
      const failed = data.results
        ?.filter((r: { success: boolean }) => !r.success)
        .map((r: { name: string }) => r.name) || [];

      setFetchResults({
        found: data.found || 0,
        notFound: data.notFound || 0,
        failed,
      });
      setFetchProgress({ current: data.total || 0, total: data.total || 0, currentName: "" });

      if (data.found > 0) {
        toast.success(`Found images for ${data.found} of ${data.total} contestants`);
      } else {
        toast.info("No images found for any contestants");
      }

      // Refresh the list
      fetchContestants();
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to fetch images");
    }

    setIsFetchingImages(false);
  };

  // Fetch image for a single contestant
  const handleFetchSingleImage = async (contestantId: string, contestantName: string) => {
    setFetchingContestantId(contestantId);

    try {
      const { data, error } = await supabase.functions.invoke("fetch-cast-images", {
        body: {
          season_number: season,
          contestant_ids: [contestantId],
          force_refresh: true,
        },
      });

      if (error) {
        console.error("Error fetching image:", error);
        toast.error(`Failed to fetch image for ${contestantName}`);
        setFetchingContestantId(null);
        return;
      }

      if (data.found > 0) {
        toast.success(`Found image for ${contestantName}`);
        fetchContestants();
      } else {
        toast.info(`No image found for ${contestantName}`);
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error(`Failed to fetch image for ${contestantName}`);
    }

    setFetchingContestantId(null);
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return;

    const lines = bulkText.split("\n").filter((line) => line.trim());
    const toInsert: Array<{
      season_number: number;
      name: string;
      tribe: string | null;
      age: number | null;
      occupation: string | null;
      image_url: string | null;
    }> = [];

    // Parse CSV: name, tribe, age, occupation, image_url
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const name = parts[0];
      if (!name) continue;

      toInsert.push({
        season_number: season,
        name,
        tribe: parts[1] || null,
        age: parts[2] ? parseInt(parts[2]) : null,
        occupation: parts[3] || null,
        image_url: parts[4] || null,
      });
    }

    if (toInsert.length === 0) {
      toast.error("No valid contestants found");
      return;
    }

    setIsSaving(true);
    const { error, data } = await supabase
      .from("master_contestants")
      .insert(toInsert)
      .select();

    if (error) {
      if (error.code === "23505") {
        toast.error("Some contestants already exist. Try removing duplicates.");
      } else {
        toast.error("Failed to import contestants");
      }
    } else {
      toast.success(`Imported ${data?.length || 0} contestants for Season ${season}`);
      setBulkText("");
      setShowBulkDialog(false);
      fetchContestants();
      // Update existing seasons list
      if (!existingSeasons.includes(season)) {
        setExistingSeasons([season, ...existingSeasons].sort((a, b) => b - a));
      }
    }
    setIsSaving(false);
  };

  const handleCSVFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const csvData = event.target?.result as string;
        const lines = csvData.split("\n").filter((line) => line.trim());
        
        if (lines.length === 0) {
          toast.error("CSV file is empty");
          return;
        }

        // Parse first row as potential headers using quote-aware parsing
        const firstRowParts = parseCSVLine(lines[0]);
        const { mapping, hasHeaders } = buildColumnMapping(firstRowParts);
        
        // Use detected mapping or fall back to positional
        const finalMapping = hasHeaders ? mapping : getPositionalMapping();
        const startIndex = hasHeaders ? 1 : 0;
        
        setRawHeaders(firstRowParts);
        setColumnMapping(finalMapping);
        setHasDetectedHeaders(hasHeaders);

        // Parse all data rows using quote-aware parsing
        const parsed: ParsedContestant[] = [];
        for (let i = startIndex; i < lines.length; i++) {
          const parts = parseCSVLine(lines[i]);
          const contestant = parseRowWithMapping(parts, finalMapping);
          if (contestant) {
            parsed.push(contestant);
          }
        }

        if (parsed.length === 0) {
          toast.error("No valid contestants found in CSV");
          return;
        }

        setPreviewData(parsed);
        setShowPreviewDialog(true);
      } catch (error) {
        toast.error("Invalid CSV format");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleWikiImport = async () => {
    setIsWikiImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-cast-images", {
        body: { season_number: season, mode: "import_cast" },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      const existing = new Set(contestants.map((c) => c.name.toLowerCase()));
      const fresh = (data.cast as ParsedContestant[]).filter((c) => !existing.has(c.name.toLowerCase()));
      if (fresh.length === 0) {
        toast.info(data.cast.length === 0
          ? `The wiki doesn't list a Season ${season} cast yet. Try again later or add them manually.`
          : "Everyone on the wiki is already added.");
        return;
      }
      setPreviewData(fresh);
      setShowPreviewDialog(true);
    } catch (e) {
      toast.error(`Couldn't import from wiki: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setIsWikiImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (previewData.length === 0) return;

    const toInsert = previewData.map((c) => ({
      season_number: season,
      name: c.name,
      tribe: c.tribe,
      age: c.age,
      occupation: c.occupation,
      image_url: c.image_url,
    }));

    setIsSaving(true);
    const { error, data } = await supabase
      .from("master_contestants")
      .insert(toInsert)
      .select();

    if (error) {
      if (error.code === "23505") {
        toast.error("Some contestants already exist. Delete existing data first.");
      } else {
        toast.error("Failed to import CSV");
      }
    } else {
      toast.success(`Imported ${data?.length || 0} contestants from CSV`);
      setShowPreviewDialog(false);
      setPreviewData([]);
      fetchContestants();
      if (!existingSeasons.includes(season)) {
        setExistingSeasons([season, ...existingSeasons].sort((a, b) => b - a));
      }
    }
    setIsSaving(false);
  };

  const startEditing = (contestant: MasterContestant) => {
    setEditingId(contestant.id);
    setFormData({
      name: contestant.name,
      tribe: contestant.tribe || "",
      age: contestant.age?.toString() || "",
      occupation: contestant.occupation || "",
      image_url: contestant.image_url || "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    resetForm();
  };

  // Generate column mapping display
  const getMappingDisplay = () => {
    const parts: string[] = [];
    if (columnMapping.name !== undefined) parts.push(`Name (col ${columnMapping.name + 1})`);
    if (columnMapping.tribe !== undefined) parts.push(`Tribe (col ${columnMapping.tribe + 1})`);
    if (columnMapping.age !== undefined) parts.push(`Age (col ${columnMapping.age + 1})`);
    if (columnMapping.occupation !== undefined) parts.push(`Occupation (col ${columnMapping.occupation + 1})`);
    if (columnMapping.image_url !== undefined) parts.push(`Image (col ${columnMapping.image_url + 1})`);
    return parts.join(", ");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-3xl">
          <Users className="h-5 w-5 text-muted-foreground" />
          Master cast management
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Season Selector */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="season-select" className="label-caps text-muted-foreground">Season</Label>
            <Input
              id="season-select"
              type="number"
              value={season}
              onChange={(e) => setSeason(parseInt(e.target.value) || 1)}
              className="w-24 tabular"
              min={1}
            />
          </div>

          {existingSeasons.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="label-caps text-muted-foreground">Quick select</span>
              {existingSeasons.slice(0, 5).map((s) => (
                <Button
                  key={s}
                  variant={s === season ? "default" : "outline"}
                  size="sm"
                  className="rounded-full tabular"
                  onClick={() => setSeason(s)}
                >
                  S{s}
                </Button>
              ))}
            </div>
          )}

          <div className="flex gap-2 w-full flex-wrap lg:w-auto lg:ml-auto">
            <Button onClick={handleWikiImport} size="sm" variant="secondary" disabled={isWikiImporting}>
              {isWikiImporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileUp className="h-4 w-4 mr-1" />}
              Import cast from wiki
            </Button>
            <Button onClick={() => setShowAddDialog(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add contestant
            </Button>
            <Button onClick={() => setShowBulkDialog(true)} variant="outline" size="sm">
              <Upload className="h-4 w-4 mr-1" />
              Bulk import
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label htmlFor="csv-file-import" className="cursor-pointer">
                <FileUp className="h-4 w-4 mr-1" />
                CSV import
                <input
                  id="csv-file-import"
                  type="file"
                  accept=".csv"
                  onChange={handleCSVFileImport}
                  className="hidden"
                />
              </label>
            </Button>
            {contestants.length > 0 && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => handleFetchImages(false)}
                disabled={isFetchingImages || missingImagesCount === 0}
              >
                <ImageIcon className="h-4 w-4 mr-1" />
                Fetch images {missingImagesCount > 0 && <span className="tabular">({missingImagesCount} missing)</span>}
              </Button>
            )}
          </div>
        </div>

        {/* Contestants Table */}
        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : contestants.length === 0 ? (
          <div className="text-center py-12 space-y-4">
            <p className="font-display text-2xl leading-none">No cast added yet for Season <span className="tabular">{season}</span></p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add contestant
              </Button>
              <Button onClick={() => setShowBulkDialog(true)} variant="outline">
                <Upload className="h-4 w-4 mr-1" />
                Bulk import
              </Button>
            </div>
          </div>
        ) : (
          <div className="glass rounded-[12px] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="label-caps">Name</TableHead>
                  <TableHead className="label-caps">Tribe</TableHead>
                  <TableHead className="label-caps text-center">Age</TableHead>
                  <TableHead className="label-caps">Occupation</TableHead>
                  <TableHead className="label-caps">Image URL</TableHead>
                  <TableHead className="label-caps text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contestants.map((c) =>
                  editingId === c.id ? (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Input
                          value={formData.name}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={formData.tribe}
                          onChange={(e) =>
                            setFormData({ ...formData, tribe: e.target.value })
                          }
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={formData.age}
                          onChange={(e) =>
                            setFormData({ ...formData, age: e.target.value })
                          }
                          className="h-9 w-16 tabular"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={formData.occupation}
                          onChange={(e) =>
                            setFormData({ ...formData, occupation: e.target.value })
                          }
                          className="h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={formData.image_url}
                          onChange={(e) =>
                            setFormData({ ...formData, image_url: e.target.value })
                          }
                          className="h-9"
                          placeholder="https://..."
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleUpdateContestant(c.id)}
                            disabled={isSaving}
                            aria-label="Save changes"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEditing}
                            aria-label="Cancel editing"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={c.id}>
                      <TableCell className="font-bold">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.tribe || "—"}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground tabular">
                        {c.age || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.occupation || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[150px]">
                        <div className="flex items-center gap-2">
                          {c.image_url ? (
                            <a
                              href={c.image_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-primary underline truncate max-w-[100px]"
                            >
                              View
                            </a>
                          ) : (
                            <span>—</span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => handleFetchSingleImage(c.id, c.name)}
                            disabled={fetchingContestantId === c.id}
                            title="Fetch image"
                            aria-label={`Fetch image for ${c.name}`}
                          >
                            {fetchingContestantId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ImageIcon className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditing(c)}
                            aria-label={`Edit ${c.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Delete ${c.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete contestant</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete {c.name}? This action
                                  cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteContestant(c.id, c.name)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-sm text-muted-foreground tabular">
          {contestants.length} contestant{contestants.length !== 1 ? "s" : ""} for Season{" "}
          {season}
        </p>

        {/* Danger zone */}
        {contestants.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-3">
            <div className="space-y-0.5">
              <p className="label-caps flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Danger zone
              </p>
              <p className="text-sm text-muted-foreground">
                Delete all contestants for Season <span className="tabular">{season}</span>
              </p>
            </div>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setShowDeleteAllDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete all
            </Button>
          </div>
        )}

        {/* Delete All Confirmation Dialog */}
        <AlertDialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Delete all contestants
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete all <strong>{contestants.length}</strong> contestants for Season {season}? 
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAllSeason}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : `Delete all ${contestants.length}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* CSV Import Preview Dialog */}
        <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>CSV import preview · Season {season}</DialogTitle>
              <DialogDescription>
                Review the parsed data before importing
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              {/* Column mapping info */}
              <div className="space-y-2">
                {hasDetectedHeaders ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">Headers detected</Badge>
                    <span className="text-sm text-muted-foreground">{getMappingDisplay()}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                    <span className="text-sm">
                      No recognizable headers found. Using positional mapping (name, tribe, age, occupation, image_url).
                    </span>
                  </div>
                )}
              </div>

              {/* Preview table */}
              <div className="glass rounded-[12px] overflow-auto flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="label-caps w-8">#</TableHead>
                      <TableHead className="label-caps">Name</TableHead>
                      <TableHead className="label-caps">Tribe</TableHead>
                      <TableHead className="label-caps">Age</TableHead>
                      <TableHead className="label-caps">Occupation</TableHead>
                      <TableHead className="label-caps">Image</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.slice(0, 10).map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground tabular">{i + 1}</TableCell>
                        <TableCell className="font-bold">{c.name}</TableCell>
                        <TableCell className="text-muted-foreground">{c.tribe || "—"}</TableCell>
                        <TableCell className="text-muted-foreground tabular">{c.age || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{c.occupation || "—"}</TableCell>
                        <TableCell className="text-muted-foreground max-w-[100px] truncate">
                          {c.image_url ? (
                            <>
                              <Check className="h-4 w-4 text-success" aria-hidden="true" />
                              <span className="sr-only">Has image</span>
                            </>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {previewData.length > 10 && (
                  <p className="text-sm text-muted-foreground tabular p-3 text-center border-t border-border">
                    ... and {previewData.length - 10} more
                  </p>
                )}
              </div>

              <p className="text-sm font-bold tabular">
                Ready to import {previewData.length} contestant{previewData.length !== 1 ? "s" : ""}
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmImport} disabled={isSaving}>
                {isSaving ? "Importing..." : `Import all ${previewData.length}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add contestant to Season {season}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="add-name" className="label-caps text-muted-foreground">Name *</Label>
                <Input
                  id="add-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Contestant name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-tribe" className="label-caps text-muted-foreground">Tribe</Label>
                  <Input
                    id="add-tribe"
                    value={formData.tribe}
                    onChange={(e) =>
                      setFormData({ ...formData, tribe: e.target.value })
                    }
                    placeholder="Tribe name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-age" className="label-caps text-muted-foreground">Age</Label>
                  <Input
                    id="add-age"
                    type="number"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                    placeholder="Age"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-occupation" className="label-caps text-muted-foreground">Occupation</Label>
                <Input
                  id="add-occupation"
                  value={formData.occupation}
                  onChange={(e) =>
                    setFormData({ ...formData, occupation: e.target.value })
                  }
                  placeholder="Occupation"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-image" className="label-caps text-muted-foreground">Image URL</Label>
                <Input
                  id="add-image"
                  value={formData.image_url}
                  onChange={(e) =>
                    setFormData({ ...formData, image_url: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddContestant} disabled={isSaving}>
                {isSaving ? "Adding..." : "Add contestant"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Import Dialog */}
        <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk import cast for Season {season}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Paste CSV data with columns: name, tribe, age, occupation, image_url (one
                contestant per line)
              </p>
              <Textarea
                placeholder="John Doe, Luvu, 32, Firefighter, https://example.com/john.jpg&#10;Jane Smith, Yase, 28, Attorney,"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBulkDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleBulkImport} disabled={isSaving || !bulkText.trim()}>
                {isSaving ? "Importing..." : "Import all"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Fetch Images Progress Dialog */}
        <Dialog open={showFetchImagesDialog} onOpenChange={(open) => {
          if (!isFetchingImages) setShowFetchImagesDialog(open);
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-muted-foreground" />
                Fetching cast images
              </DialogTitle>
              <DialogDescription>
                Searching for official headshots using AI...
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              {isFetchingImages ? (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="label-caps text-muted-foreground">Progress</span>
                      <span className="font-bold tabular">{fetchProgress.current} / {fetchProgress.total}</span>
                    </div>
                    <Progress value={(fetchProgress.current / Math.max(fetchProgress.total, 1)) * 100} />
                  </div>
                  
                  {fetchProgress.currentName && (
                    <p className="text-sm text-muted-foreground">
                      Current: <span className="font-bold text-foreground">{fetchProgress.currentName}</span>
                    </p>
                  )}
                  
                  <div className="flex gap-4 text-sm">
                    <span className="inline-flex items-center gap-1 font-bold text-success tabular">
                      <Check className="h-4 w-4" aria-hidden="true" /> Found: {fetchResults.found}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground tabular">
                      <X className="h-4 w-4" aria-hidden="true" /> Not found: {fetchResults.notFound}
                    </span>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-4 text-sm">
                    <span className="inline-flex items-center gap-1 font-bold text-success tabular">
                      <Check className="h-4 w-4" aria-hidden="true" /> Found: {fetchResults.found}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground tabular">
                      <X className="h-4 w-4" aria-hidden="true" /> Not found: {fetchResults.notFound}
                    </span>
                  </div>
                  
                  {fetchResults.failed.length > 0 && (
                    <div className="space-y-2">
                      <p className="label-caps text-muted-foreground">Failed contestants</p>
                      <div className="glass max-h-32 overflow-auto rounded-[10px] p-2 text-sm text-muted-foreground">
                        {fetchResults.failed.map((name, i) => (
                          <div key={i}>{name}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              {isFetchingImages ? (
                <Button 
                  variant="outline" 
                  onClick={() => {
                    abortControllerRef.current?.abort();
                    setIsFetchingImages(false);
                  }}
                >
                  Cancel
                </Button>
              ) : (
                <Button onClick={() => setShowFetchImagesDialog(false)}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
