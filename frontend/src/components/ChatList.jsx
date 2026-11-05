import { useChat } from '../context/ChatContext';
import { LoadingSpinner, EmptyState } from './common';

function timeAgo(isoString) {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ChatList({ activeUserId, onSelect, loading }) {
  const { conversations, onlineStatus } = useChat();

  if (loading) return <LoadingSpinner label="Loading conversations…" />;
  if (conversations.length === 0) {
    return <EmptyState title="No conversations yet" description="Messages with providers or customers will show up here." />;
  }

  return (
    <ul className="divide-y divide-ink/5 overflow-y-auto">
      {conversations.map((c) => {
        const isActive = c.other_user_id === activeUserId;
        const isOnline = onlineStatus[c.other_user_id];
        return (
          <li key={c.other_user_id}>
            <button
              onClick={() => onSelect(c.other_user_id, c.other_user_name)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition ${
                isActive ? 'bg-marigold/10' : 'hover:bg-linen/60'
              }`}
            >
              <div className="relative shrink-0">
                <img
                  src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.other_user_name || 'User')}`}
                  alt=""
                  className="w-11 h-11 rounded-full bg-linen"
                />
                <span
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                    isOnline ? 'bg-forest' : 'bg-slate/40'
                  }`}
                  title={isOnline ? 'Online' : 'Offline'}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink truncate">{c.other_user_name}</p>
                  <span className="text-xs text-slate shrink-0">{timeAgo(c.last_message_at)}</span>
                </div>
                <p className={`text-xs truncate mt-0.5 ${c.unread_count > 0 ? 'text-ink font-medium' : 'text-slate'}`}>
                  {c.last_message || 'No messages yet'}
                </p>
              </div>
              {c.unread_count > 0 && (
                <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-clay text-white text-[11px] font-semibold flex items-center justify-center">
                  {c.unread_count}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
