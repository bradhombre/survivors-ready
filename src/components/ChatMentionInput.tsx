import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";

export interface MentionableUser {
  id: string;
  name: string;
  isBot?: boolean;
  isOnline?: boolean;
}

interface ChatMentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  mentionableUsers: MentionableUser[];
  inputRef?: React.RefObject<HTMLInputElement>;
}

export function ChatMentionInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  maxLength,
  disabled,
  mentionableUsers,
  inputRef,
}: ChatMentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const internalRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  const actualRef = inputRef || internalRef;

  // Filter users based on query
  const filteredUsers = mentionableUsers
    .filter((user) =>
      user.name.toLowerCase().includes(mentionQuery.toLowerCase())
    )
    .sort((a, b) => {
      // Prioritize bots first, then online users
      if (a.isBot && !b.isBot) return -1;
      if (!a.isBot && b.isBot) return 1;
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return a.name.localeCompare(b.name);
    });

  // Detect @ trigger and extract query
  const detectMention = useCallback((inputValue: string, cursorPos: number) => {
    // Find the last @ before cursor
    const textBeforeCursor = inputValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex >= 0) {
      // Check if @ is at start or preceded by whitespace
      const charBefore = lastAtIndex > 0 ? inputValue[lastAtIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAtIndex === 0) {
        const textAfterAt = inputValue.slice(lastAtIndex + 1, cursorPos);
        // No space in the mention query
        if (!textAfterAt.includes(" ")) {
          setMentionStart(lastAtIndex);
          setMentionQuery(textAfterAt);
          setShowSuggestions(true);
          setSelectedIndex(0);
          return;
        }
      }
    }

    setShowSuggestions(false);
    setMentionStart(-1);
    setMentionQuery("");
  }, []);

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    detectMention(newValue, e.target.selectionStart || 0);
  };

  // Handle selection
  const selectMention = useCallback(
    (user: MentionableUser) => {
      if (mentionStart < 0) return;

      const beforeMention = value.slice(0, mentionStart);
      const afterCursor = value.slice(
        mentionStart + 1 + mentionQuery.length
      );
      
      // Use lowercase name for @jeffbot to trigger the bot
      const mentionText = user.isBot 
        ? `@${user.name.toLowerCase().replace(" 🏝️", "")} `
        : `@${user.name} `;
      
      const newValue = beforeMention + mentionText + afterCursor;
      onChange(newValue);
      setShowSuggestions(false);

      // Focus and set cursor after mention
      setTimeout(() => {
        if (actualRef.current) {
          const newCursorPos = beforeMention.length + mentionText.length;
          actualRef.current.focus();
          actualRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [mentionStart, mentionQuery, value, onChange, actualRef]
  );

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && filteredUsers.length > 0) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredUsers.length - 1 ? prev + 1 : 0
          );
          return;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredUsers.length - 1
          );
          return;
        case "Tab":
        case "Enter":
          if (filteredUsers[selectedIndex]) {
            e.preventDefault();
            selectMention(filteredUsers[selectedIndex]);
            return;
          }
          break;
        case "Escape":
          e.preventDefault();
          setShowSuggestions(false);
          return;
      }
    }

    // Pass through to parent handler (for sending message on Enter)
    if (!showSuggestions || e.key !== "Enter") {
      onKeyDown(e);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (showSuggestions && suggestionsRef.current) {
      const selectedEl = suggestionsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, showSuggestions]);

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        actualRef.current &&
        !actualRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actualRef]);

  return (
    <div className="relative flex-1">
      <Input
        ref={actualRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        className="pr-16"
      />

      {/* Mention suggestions popover */}
      {showSuggestions && filteredUsers.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute bottom-full left-0 right-0 mb-2 bg-popover border-2 border-plank rounded-[12px] shadow-md max-h-48 overflow-y-auto z-50 py-1"
        >
          {filteredUsers.map((user, index) => (
            <button
              key={user.id}
              type="button"
              onClick={() => selectMention(user)}
              className={cn(
                "w-full min-h-[44px] px-3 py-2 text-left text-sm font-bold flex items-center gap-2 hover:bg-muted transition-colors",
                index === selectedIndex && "bg-muted"
              )}
            >
              {user.isBot ? (
                <Bot className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              ) : (
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    user.isOnline ? "bg-success" : "border-[1.5px] border-input"
                  )}
                />
              )}
              <span className="truncate">{user.name}</span>
              {user.isOnline && !user.isBot && (
                <span className="text-xs font-semibold text-success ml-auto">online</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
