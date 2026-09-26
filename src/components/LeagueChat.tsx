import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, TreePalm } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatMentionInput, MentionableUser } from "@/components/ChatMentionInput";
import { OnlineUsersPopover } from "@/components/OnlineUsersPopover";
import { useChatMessages, ChatMessage as ChatMessageType } from "@/hooks/useChatMessages";
import { useChatPresence } from "@/hooks/useChatPresence";
import { useIsMobile } from "@/hooks/use-mobile";
import { getDisplayName } from "@/lib/displayNameUtils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isToday, isSameDay } from "date-fns";

interface LeagueTeam {
  id: string;
  name: string;
  user_id: string | null;
}

interface LeagueChatProps {
  leagueId: string | undefined;
  userId: string | undefined;
  userEmail: string | undefined;
  userTeamName: string | undefined;
  teams: LeagueTeam[];
}

const STORAGE_KEY = "league-chat-expanded";
const RATE_LIMIT_MS = 2000;

export function LeagueChat({ leagueId, userId, userEmail, userTeamName, teams }: LeagueChatProps) {
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });
  const [inputValue, setInputValue] = useState("");
  const [canSend, setCanSend] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isExpandedRef = useRef(isExpanded);
  const isMobile = useIsMobile();

  // Keep ref in sync
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  // Use team name, fall back to email username
  const currentUserDisplayName = userTeamName || (userEmail ? getDisplayName(null, userEmail) : undefined);

  // Handle new message notifications
  const handleNewMessage = useCallback((message: ChatMessageType) => {
    // Only show notification if chat is collapsed
    if (!isExpandedRef.current) {
      const senderName = message.user_display_name || "Someone";
      const preview = message.content.length > 50 
        ? message.content.slice(0, 50) + "..." 
        : message.content;
      
      toast(
        <div className="cursor-pointer" onClick={() => setIsExpanded(true)}>
          <div className="font-medium">{senderName}</div>
          <div className="text-sm text-muted-foreground truncate">{preview}</div>
        </div>,
        { duration: 5000 }
      );
    }
  }, []);

  const {
    messages,
    loading,
    isSending,
    isJeffBotTyping,
    sendMessage,
    toggleReaction,
    getUnreadCount,
    markAllRead,
  } = useChatMessages({ leagueId, userId, onNewMessage: handleNewMessage });

  const { onlineUsers, othersOnline } = useChatPresence({ 
    leagueId, 
    userId, 
    userDisplayName: currentUserDisplayName 
  });

  // Build mentionable users list - include all claimed teams (including self)
  const mentionableUsers: MentionableUser[] = [
    { id: "jeffbot", name: "JeffBot 🏝️", isBot: true, isOnline: true },
    ...teams
      .filter(t => t.user_id) // Include all claimed teams
      .map(t => ({
        id: t.user_id!,
        name: t.name,
        isBot: false,
        isOnline: onlineUsers.some(ou => ou.user_id === t.user_id),
      })),
  ];

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded));
    if (isExpanded) {
      markAllRead();
      // Focus input when expanded
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isExpanded, markAllRead]);

  // Auto-scroll on new messages or when chat is opened
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      const scrollToBottom = () => {
        const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      };
      // Immediate attempt
      scrollToBottom();
      // Delayed attempt to catch late renders
      const timer = setTimeout(scrollToBottom, 150);
      return () => clearTimeout(timer);
    }
  }, [messages, isExpanded, isJeffBotTyping]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !canSend || isSending) return;

    const content = inputValue;
    setInputValue("");
    setCanSend(false);

    try {
      await sendMessage(content);
    } catch (error) {
      if (error instanceof Error && error.message.includes("JeffBot")) {
        toast.error("JeffBot is taking a break, try again");
      } else {
        toast.error("Failed to send message");
      }
    }

    setTimeout(() => setCanSend(true), RATE_LIMIT_MS);
  }, [inputValue, canSend, isSending, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const unreadCount = isExpanded ? 0 : getUnreadCount();
  const charCount = inputValue.length;
  const isOverLimit = charCount > 500;

  // Determine which messages need date separators
  const messagesWithSeparators = messages.map((msg, idx) => {
    if (idx === 0) return { ...msg, showDateSeparator: true };
    const prevDate = new Date(messages[idx - 1].created_at);
    const currDate = new Date(msg.created_at);
    return { ...msg, showDateSeparator: !isSameDay(prevDate, currDate) };
  });

  if (!leagueId || !userId) return null;

  return (
    <div
      className={cn(
        "fixed z-50 transition-all duration-300",
        isExpanded
          ? isMobile
            ? "bottom-[calc(5rem+env(safe-area-inset-bottom))] right-2 left-2"
            : "bottom-4 right-4 w-[350px]"
          : isMobile
            ? "bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4"
            : "bottom-4 right-4"
      )}
    >
      {/* Collapsed FAB */}
      {!isExpanded && (
        <Button
          data-tour="chat"
          onClick={() => setIsExpanded(true)}
          size="lg"
          className="relative h-14 w-14 rounded-full p-0 [&_svg]:size-6"
          aria-label="Open league chat"
        >
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1.5 -right-1.5 h-6 min-w-6 justify-center border-plank px-1 text-xs tabular"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      )}

      {/* Expanded Chat Panel */}
      {isExpanded && (
        <div
          className={cn(
            "plank flex flex-col overflow-hidden shadow-md",
            isMobile ? "h-[60vh]" : "h-[450px]"
          )}
        >
          {/* Header */}
          <div className="bg-header flex items-center justify-between gap-2 py-2 pl-4 pr-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-display text-2xl leading-none">League chat</span>
              {onlineUsers.length > 0 && (
                <OnlineUsersPopover onlineUsers={onlineUsers} currentUserId={userId}>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[hsl(var(--header-fg))] bg-success animate-pulse" />
                    <span className="text-header-label text-xs font-bold tabular">
                      {onlineUsers.length} online
                    </span>
                  </div>
                </OnlineUsersPopover>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(false)}
              className="h-11 w-11 shrink-0 text-[hsl(var(--header-fg))] hover:bg-[hsl(var(--header-fg)/0.12)] hover:text-[hsl(var(--header-fg))]"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-3" ref={scrollRef}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-2">
                <TreePalm className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
                <p className="font-display text-2xl leading-none">Meet JeffBot</p>
                <p className="text-xs text-muted-foreground mt-2 mb-3">
                  Your Survivor encyclopedia! Tag <span className="font-bold text-foreground">@jeffbot</span> with any question.
                </p>
                <div className="flex flex-col gap-2 w-full max-w-[260px]">
                  {[
                    "Who won Season 45?",
                    "Best blindsides ever?",
                    "Explain the idol rules",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => {
                        setInputValue(`@jeffbot ${prompt}`);
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                      className="glass flex min-h-[40px] items-center gap-2 rounded-full px-4 text-left text-sm font-bold transition-colors hover:bg-muted"
                    >
                      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {messagesWithSeparators.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    id={msg.id}
                    content={msg.content}
                    isBot={msg.is_bot}
                    displayName={msg.user_display_name || msg.user_email?.split("@")[0] || "Unknown"}
                    createdAt={msg.created_at}
                    isOwn={!msg.is_bot && msg.user_id === userId}
                    reactions={msg.reactions}
                    currentUserId={userId}
                    onToggleReaction={toggleReaction}
                    showDateSeparator={msg.showDateSeparator}
                  />
                ))}
                
                {/* JeffBot typing indicator */}
                {isJeffBotTyping && (
                  <div className="mr-auto max-w-[85%] rounded-[14px] rounded-bl-[4px] border-[1.5px] border-accent bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs font-bold text-accent">
                        <TreePalm className="h-3 w-3" aria-hidden="true" />
                        JeffBot
                      </span>
                      <span className="text-xs text-muted-foreground">is typing...</span>
                    </div>
                    <div className="flex gap-1 mt-1">
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="p-3 border-t-2 border-plank bg-card">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <ChatMentionInput
                  inputRef={inputRef}
                  value={inputValue}
                  onChange={setInputValue}
                  onKeyDown={handleKeyDown}
                  placeholder="Message or @jeffbot question..."
                  maxLength={500}
                  disabled={isSending}
                  mentionableUsers={mentionableUsers}
                />
                {charCount > 400 && (
                  <span
                    className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold tabular",
                      isOverLimit ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {charCount}/500
                  </span>
                )}
              </div>
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim() || isOverLimit || !canSend || isSending}
                size="icon"
                variant="accent"
                className="shrink-0"
                aria-label="Send message"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
