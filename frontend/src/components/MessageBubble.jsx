function formatMessageTimestamp(isoString) {
  const date = new Date(isoString);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
}

export default function MessageBubble({ message, isMine }) {
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-2.5`}>
      <div className={`max-w-[75%] sm:max-w-[60%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm ${
            isMine ? 'bg-marigold text-ink rounded-br-sm' : 'bg-white border border-ink/10 text-ink rounded-bl-sm'
          }`}
        >
          {message.attachment_url && (
            <a href={message.attachment_url} target="_blank" rel="noreferrer" className="block mb-1.5">
              <img src={message.attachment_url} alt="Attachment" className="rounded-lg max-h-48 object-cover" />
            </a>
          )}
          {message.message && <p className="whitespace-pre-wrap break-words">{message.message}</p>}
        </div>
        <span className="text-[11px] text-slate mt-1 px-1">
          {formatMessageTimestamp(message.created_at)}
          {isMine && message.read && <span className="ml-1 text-forest">· Read</span>}
        </span>
      </div>
    </div>
  );
}
