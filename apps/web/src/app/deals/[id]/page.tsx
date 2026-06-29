'use client';
import { useState, useEffect, useRef, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Msg {
  id: string;
  body: string | null;
  file_url: string | null;
  file_name: string | null;
  sender_company_id: string;
  created_at: string;
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

function FileAttachment({ file_url, file_name }: { file_url: string; file_name: string }) {
  const url = `http://84.247.189.142${file_url}`;
  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file_name);
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={file_name}
          style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: 'block', marginTop: 4 }} />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: '.4rem', color: 'inherit', textDecoration: 'none',
        background: 'rgba(0,0,0,.07)', borderRadius: 6, padding: '.3rem .6rem', marginTop: 4, fontSize: '.85rem' }}>
      <span>📎</span>
      <span style={{ textDecoration: 'underline' }}>{file_name}</span>
    </a>
  );
}

export default function DealChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Deal>(`/deals/${id}`).then(setDeal).catch(() => {});
    api.get<Msg[]>(`/deals/${id}/messages`).then(setMessages).catch(() => {});
  }, [id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true); setError('');
    try {
      const msg = await api.post<Msg>(`/deals/${id}/messages`, { body });
      setMessages(m => [...m, msg]);
      setBody('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('File too large (max 10 MB)'); return; }
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (body.trim()) fd.append('body', body.trim());
      const msg = await api.upload<Msg>(`/deals/${id}/messages/upload`, fd);
      setMessages(m => [...m, msg]);
      setBody('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
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

        {error && <div className="alert alert-error" style={{ marginBottom: '.75rem' }}>{error}</div>}

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
                    {m.body && <div>{m.body}</div>}
                    {m.file_url && m.file_name && (
                      <FileAttachment file_url={m.file_url} file_name={m.file_name} />
                    )}
                    <div className="chat-time">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
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
              disabled={sending || uploading}
            />
            {/* Hidden file input */}
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleFile}
            />
            <button
              type="button"
              className="btn btn-secondary"
              title="Attach file"
              disabled={sending || uploading}
              onClick={() => fileRef.current?.click()}
              style={{ padding: '0 .75rem', fontSize: '1.1rem' }}
            >
              {uploading ? '⏳' : '📎'}
            </button>
            <button className="btn btn-primary" type="submit" disabled={sending || uploading || !body.trim()}>
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
