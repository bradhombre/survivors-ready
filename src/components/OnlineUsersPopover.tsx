import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface OnlineUser {
  user_id: string;
  display_name: string;
}

interface OnlineUsersPopoverProps {
  onlineUsers: OnlineUser[];
  currentUserId: string | undefined;
  children: React.ReactNode;
}

export function OnlineUsersPopover({
  onlineUsers,
  currentUserId,
  children,
}: OnlineUsersPopoverProps) {
  if (onlineUsers.length === 0) {
    return <>{children}</>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex min-h-[36px] items-center gap-1 rounded-full hover:opacity-80 transition-opacity cursor-pointer">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 rounded-[12px] border-2 border-plank p-3" align="start">
        <div className="label-caps text-muted-foreground mb-2">
          Online now
        </div>
        <div className="space-y-1">
          {onlineUsers.map((user) => (
            <div
              key={user.user_id}
              className="flex items-center gap-2 py-1.5 text-sm font-bold"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-success flex-shrink-0" aria-hidden="true" />
              <span className="truncate">
                {user.display_name}
                {user.user_id === currentUserId && (
                  <span className="text-muted-foreground font-normal ml-1">(you)</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
