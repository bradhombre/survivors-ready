import { format, isToday, isYesterday } from "date-fns";
import { cn } from "@/lib/utils";
import { ThumbsUp, Flame, Laugh } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatMessageProps {
  id: string;
  content: string;
  isBot: boolean;
  displayName: string;
  createdAt: string;
  reactions: Record<string, string[]>;
  currentUserId: string | undefined;
  onToggleReaction: (messageId: string, emoji: string) => void;
  showDateSeparator?: boolean;
  /** Presentation only: true when the current user sent this message. */
  isOwn?: boolean;
}

const REACTION_EMOJIS = [
  { key: "thumbsUp", icon: ThumbsUp, label: "👍" },
  { key: "fire", icon: Flame, label: "🔥" },
  { key: "laugh", icon: Laugh, label: "😂" },
];

export function ChatMessage({
  id,
  content,
  isBot,
  displayName,
  createdAt,
  reactions,
  currentUserId,
  onToggleReaction,
  showDateSeparator,
  isOwn = false,
}: ChatMessageProps) {
  const date = new Date(createdAt);
  const timeStr = format(date, "h:mm a");
  
  const getDateLabel = () => {
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMMM d, yyyy");
  };

  return (
    <>
      {showDateSeparator && (
        <div className="flex items-center gap-2 my-3">
          <div className="flex-1 h-px bg-border" />
          <span className="label-caps text-muted-foreground px-2">{getDateLabel()}</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      
      <div
        className={cn(
          "group px-3 py-2 rounded-[14px] max-w-[85%]",
          isBot
            ? "bg-card border-[1.5px] border-accent text-foreground rounded-bl-[4px] ml-0 mr-auto"
            : isOwn
              ? "bg-primary text-primary-foreground rounded-br-[4px] ml-auto mr-0"
              : "bg-muted text-foreground rounded-bl-[4px] ml-0 mr-auto"
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={cn(
            "text-xs font-bold",
            isBot ? "text-accent" : isOwn ? "text-primary-foreground" : "text-foreground"
          )}>
            {displayName}
          </span>
          <span className={cn("text-xs tabular", isOwn && !isBot ? "text-primary-foreground/70" : "text-muted-foreground")}>{timeStr}</span>
        </div>
        
        <p className="text-sm whitespace-pre-wrap break-words">
          {content}
        </p>

        {/* Reactions */}
        <div className="flex items-center gap-1 mt-2">
          {REACTION_EMOJIS.map(({ key, icon: Icon, label }) => {
            const reactionUsers = reactions[key] || [];
            const hasReacted = currentUserId && reactionUsers.includes(currentUserId);
            const count = reactionUsers.length;

            return (
              <Button
                key={key}
                variant="ghost"
                size="sm"
                onClick={() => onToggleReaction(id, key)}
                className={cn(
                  "h-9 sm:h-7 rounded-full px-2 text-xs tabular sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                  isOwn && !isBot && "hover:bg-primary-foreground/15 hover:text-primary-foreground",
                  count > 0 && "opacity-100",
                  hasReacted && "bg-accent text-accent-foreground hover:bg-accent/90 hover:text-accent-foreground"
                )}
              >
                <Icon className="h-3 w-3 mr-0.5" />
                {count > 0 && <span>{count}</span>}
              </Button>
            );
          })}
        </div>
      </div>
    </>
  );
}
