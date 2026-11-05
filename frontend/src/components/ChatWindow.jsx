import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { getSocket } from '../socket';
import { chatApi } from '../api/chats';
import MessageBubble from './MessageBubble';
import { LoadingSpinner, ErrorMessage } from './common';

const TYPING_IDLE_MS = 2000;

export default function ChatWindow({ otherUserId, otherUserName }) {
  const { user } = useAuth();
  const { onlineStatus, refreshConversations } = useChat();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  const isOnline = onlineStatus[otherUserId];

  // ── Load history + join the conversation room ────────────────────────
  useEffect(() => {
    if (!otherUserId) return;
    let cancelled = false;

    setLoading(true);
    setError('');
    chatApi
      .getMessages(otherUserId)
      .then(({ data }) => {
        if (!cancelled) setMessages(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const socket = getSocket();
    socket?.emit('join_room', { otherUserId });
    // Opening a chat implicitly catches it up - mark unread messages read.
    chatApi.markRead(otherUserId).then(refreshConversations).catch(() => {});

    return () => {
      cancelled = true;
      socket?.emit('leave_room', { otherUserId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherUserId]);

  // ── Live message/typing/read events scoped to this open conversation ──
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !otherUserId) return;

    const handleNewMessage = (msg) => {
      const involvesThisChat =
        (msg.sender_id === otherUserId && msg.receiver_id === user.id) ||
        (msg.sender_id === user.id && msg.receiver_id === otherUserId);
      if (!involvesThisChat) return;

      setMessages((prev) => [...prev, msg]);
      if (msg.sender_id === otherUserId) {
        chatApi.markRead(otherUserId).then(refreshConversations).catch(() => {});
      }
    };

    const handleTyping = ({ senderId, isTyping }) => {
      if (senderId === otherUserId) setOtherTyping(isTyping);
    };

    const handleRead = ({ readBy }) => {
      if (readBy === otherUserId) {
        setMessages((prev) => prev.map((m) => (m.sender_id === user.id ? { ...m, read: true } : m)));
      }
    };

    socket.on('new_message', handleNewMessage);
    socket.on('typing', handleTyping);
    socket.on('messages_read', handleRead);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('typing', handleTyping);
      socket.off('messages_read', handleRead);
    };
  }, [otherUserId, user.id, refreshConversations]);

  // ── Auto-scroll to the latest message ────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, otherTyping]);

  const handleTypingChange = (value) => {
    setText(value);
    const socket = getSocket();
    if (!socket) return;

    socket.emit('typing', { receiverId: otherUserId, isTyping: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { receiverId: otherUserId, isTyping: false });
    }, TYPING_IDLE_MS);
  };

  const handleAttachmentChange = (e) => {
    const file = e.target.files?.[0];
    if (file) setAttachmentPreview({ file, url: URL.createObjectURL(file) });
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !attachmentPreview) return;

    const socket = getSocket();
    if (!socket?.connected) {
      setError('Not connected. Reconnecting… please try again in a moment.');
      return;
    }

    setSending(true);
    setError('');

    // NOTE: this demo sends the attachment's local blob URL directly, since
    // no file-upload endpoint exists yet in bulk-backend. Swap
    // `attachmentPreview.url` for a real uploaded URL (e.g. from an
    // /uploads endpoint) before shipping - blob: URLs only work in the
    // browser tab that created them, not for the other participant.
    socket.emit(
      'send_message',
      { receiverId: otherUserId, message: trimmed, attachmentUrl: attachmentPreview?.url },
      (ack) => {
        setSending(false);
        if (!ack?.success) {
          setError(ack?.message || 'Failed to send message.');
          return;
        }
        setText('');
        setAttachmentPreview(null);
        clearTimeout(typingTimeoutRef.current);
        socket.emit('typing', { receiverId: otherUserId, isTyping: false });
      }
    );
  };

  if (!otherUserId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate text-sm">
        Select a conversation to start chatting.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-ink/10 flex items-center gap-3 shrink-0">
        <img
          src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(otherUserName || 'User')}`}
          alt=""
          className="w-9 h-9 rounded-full bg-linen"
        />
        <div>
          <p className="text-sm font-semibold text-ink">{otherUserName}</p>
          <p className="text-xs text-slate">{isOnline ? 'Online' : 'Offline'}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {loading && <LoadingSpinner label="Loading messages…" />}
        {!loading && error && <ErrorMessage message={error} />}
        {!loading &&
          !error &&
          messages.map((m) => <MessageBubble key={m.id} message={m} isMine={m.sender_id === user.id} />)}

        {otherTyping && (
          <div className="flex justify-start mb-2">
            <div className="bg-white border border-ink/10 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate/60 animate-bounce" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="border-t border-ink/10 p-3 shrink-0">
        {attachmentPreview && (
          <div className="mb-2 flex items-center gap-2">
            <img src={attachmentPreview.url} alt="Attachment preview" className="h-14 w-14 object-cover rounded-md" />
            <button
              type="button"
              onClick={() => setAttachmentPreview(null)}
              className="text-xs text-clay font-medium"
            >
              Remove
            </button>
          </div>
        )}
        {error && <p className="error-text mb-2">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 shrink-0 rounded-full hover:bg-linen flex items-center justify-center text-ink"
            aria-label="Attach image"
          >
            📎
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAttachmentChange} className="hidden" />
          <input
            value={text}
            onChange={(e) => handleTypingChange(e.target.value)}
            placeholder="Type a message…"
            className="input-field flex-1"
          />
          <button type="submit" disabled={sending || (!text.trim() && !attachmentPreview)} className="btn-primary shrink-0">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
