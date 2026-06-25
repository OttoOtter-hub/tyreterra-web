'use client';
import { useState, useEffect, useRef, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../lib/api';

interface Msg {
  id: string; body: string; sender_company_id: string; created_at: string;
}

interface Deal {
  id: string;
  offer?: {
    request?: {
      buyer_company_id: string;
      listing?: { size_raw: string; brand: string; company_id: string };
    };
  };
}

export default function DealChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Deal>(`/deals/${id}`).then(setDeal).catch(() => {});
    api.get<Msg[]>(`/deals/${id}/messages`).then(setMessages).catch(() => {});
  }, [id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      const msg = await api.post<Msg>(`/deals/${id}/messages`, { body });
      setMessages(m => [...m, msg]);
      setBody('');
    } finally {
      setSending(false);
    }
  }

  const listing = deal?.offer?.request?.listing;
  const myCompanyId = user?.company_id;

  return (
    <>
      <Navbar />
      <div className="container page" style={{ maxWidth: 700 }}>
        <div className="page-header">
          <h1>{listing ? `${listing.brand} ${listing.size_raw}` : 'Deal'}</h1>
          <span style={{ fontSize: '.85rem', color: '#6b7280' }}>In-deal chat</span>
        </div>

        <div className="chat-wrap">
          <div className="chat-messages">
            {messages.length === 0 && (
              <p style={{ color: '#9ca3af', textAlign: 'center', margin: 'auto' }}>
                No messages yet. Start the conversation.
              </p>
            )}
            {messages.map(m => {
              const mine = m.sender_company_id === myCompanyId;
              return (
                <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  <div className={`chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                    {m.body}
                    <div className="chat-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form className="chat-input-row" onSubmit={send}>
            <input
              className="form-control"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type a message…"
              disabled={sending}
            />
            <button className="btn btn-primary" type="submit" disabled={sending || !body.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
