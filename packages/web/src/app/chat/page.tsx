import { ChatPanel } from "@/components/chat/ChatPanel";

export default function ChatPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col px-6 py-8">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">Talk to your agent from the dashboard.</p>
      </header>
      <ChatPanel />
    </main>
  );
}
