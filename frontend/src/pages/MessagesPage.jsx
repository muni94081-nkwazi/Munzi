import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ChatList from '../components/ChatList';
import ChatWindow from '../components/ChatWindow';

export default function MessagesPage() {
  const [searchParams] = useSearchParams();
  const [activeUserId, setActiveUserId] = useState(searchParams.get('userId') || null);
  const [activeUserName, setActiveUserName] = useState('');
  const [showListOnMobile, setShowListOnMobile] = useState(!activeUserId);

  const handleSelect = (userId, name) => {
    setActiveUserId(userId);
    setActiveUserName(name);
    setShowListOnMobile(false);
  };

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex-1 flex min-h-0 border-t border-ink/10 sm:border sm:rounded-lg sm:my-4 sm:h-[80vh] overflow-hidden bg-white">
        {/* Conversation list */}
        <div
          className={`w-full sm:w-80 border-r border-ink/10 flex flex-col ${
            showListOnMobile ? 'flex' : 'hidden sm:flex'
          }`}
        >
          <div className="px-4 py-3 border-b border-ink/10 shrink-0">
            <h1 className="font-display font-semibold text-ink">Messages</h1>
          </div>
          <ChatList activeUserId={activeUserId} onSelect={handleSelect} />
        </div>

        {/* Chat window */}
        <div className={`flex-1 flex-col min-w-0 ${showListOnMobile ? 'hidden sm:flex' : 'flex'}`}>
          {!showListOnMobile && (
            <button
              onClick={() => setShowListOnMobile(true)}
              className="sm:hidden px-4 py-2 text-sm text-ink font-medium border-b border-ink/10 text-left"
            >
              ← Back to conversations
            </button>
          )}
          <ChatWindow otherUserId={activeUserId} otherUserName={activeUserName} />
        </div>
      </div>
    </div>
  );
}
