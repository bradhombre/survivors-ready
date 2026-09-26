import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const EMOJI_CATEGORIES = {
  "Sports & Games": ["🏆", "🥇", "🥈", "🥉", "🎯", "🎪", "🎲", "🎮", "🎳", "🏅"],
  "Nature & Weather": ["🌴", "🔥", "🌟", "⭐", "💎", "🗿", "⚡", "🌊", "🌈", "❄️"],
  "Expressions": ["😭", "😱", "🤦", "😤", "🙈", "😎", "🥳", "😈", "👀", "💀"],
  "Objects": ["👑", "🎭", "⚖️", "📺", "🎪", "🏳️", "💔", "💰", "🎁", "📸"],
  "Symbols": ["✅", "❌", "⚠️", "🚫", "💢", "💥", "✨", "🔮", "🎵", "💫"],
  "Hands & People": ["👏", "🤝", "💪", "🙌", "👍", "👎", "🤞", "✌️", "🖐️", "👋"],
};

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  disabled?: boolean;
}

export function EmojiPicker({ value, onChange, disabled }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (emoji: string) => {
    onChange(emoji);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-14 h-9 text-xl p-0"
          disabled={disabled}
        >
          {value || "⭐"}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-72 p-3 bg-popover border border-border shadow-lg z-50" 
        align="start"
        sideOffset={5}
      >
        <div className="space-y-3">
          {Object.entries(EMOJI_CATEGORIES).map(([category, emojis]) => (
            <div key={category}>
              <p className="text-xs text-muted-foreground mb-1.5">{category}</p>
              <div className="flex flex-wrap gap-1">
                {emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSelect(emoji)}
                    className={`w-8 h-8 text-lg rounded hover:bg-muted transition-colors flex items-center justify-center ${
                      value === emoji ? "bg-accent ring-2 ring-primary" : ""
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
