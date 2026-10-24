import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { getMessages, sendMessage, uploadChatFile, subscribeMessages } from '../api';
import { BRAND, brandButtonGradient } from '../theme';

// ─── Team group chat ──────────────────────────────────────────────────────────
// Floating button + panel, shared by EmployeePage and ManagerDashboard.
// props:
//   me          { id, name, role: 'employee' | 'manager', color }
//   tasks       tasks the sender can link (shown in the 📋 picker)
//   linkTask    a task to attach to the next message (set by a "💬" button on a task card)
//   onLinkHandled()  called once linkTask has been picked up
//   onTaskClick(msg) optional — jump to the linked task when its chip is clicked

const STATUS_COLOR = {
  'Briefed': '#6B7280', 'In Progress': '#3B82F6', 'Submitted': '#F59E0B',
  'Approved': '#10B981', 'Rejected': '#EF4444', 'Assigned': '#8B5CF6'
};

const fmtTime = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return today ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
};

const PAGE_SIZE = 200;

const taskLabel =(t) => `${t.task_name} · ${t.employee_name} · ${String(t.date).substring(0, 10)}`;

export default function TeamChat({ me, tasks = [], linkTask, onLinkHandled, onTaskClick }) {
  const [open, setOpen]             = useState(false);
  const [messages, setMessages]     = useState([]);
  const [loaded, setLoaded]         = useState(false);
  const [text, setText]             = useState('');
  const [file, setFile]             = useState(null);
  const [task, setTask]             = useState(null);
  const [pickingTask, setPickingTask] = useState(false);
  const [sending, setSending]       = useState(false);
  const [hasMore, setHasMore]       = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  // set before prepending older messages, so we keep the scroll position instead of jumping to the bottom
  const prevScrollHeight = useRef(null);

  // Load history + live updates
  useEffect(() => {
    let alive = true;
    getMessages(PAGE_SIZE).then(rows => {
      if (alive) { setMessages(rows); setHasMore(rows.length === PAGE_SIZE); setLoaded(true); }
    });
    const unsub = subscribeMessages(row => {
      setMessages(prev => prev.some(m => m.id === row.id) ? prev : [...prev, row]);
    });
    return () => { alive = false; unsub(); };
  }, []);

  // "💬 Discuss" from a task card opens the chat with that task attached
  useEffect(() => {
    if (!linkTask) return;
    setTask(linkTask); setOpen(true); setPickingTask(false);
    onLinkHandled && onLinkHandled();
  }, [linkTask]); // eslint-disable-line

  useEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    if (prevScrollHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [open, messages.length]);

  const loadOlder = async () => {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const rows = await getMessages(PAGE_SIZE, messages[0].created_at);
      setHasMore(rows.length === PAGE_SIZE);
      if (rows.length) {
        prevScrollHeight.current = listRef.current ? listRef.current.scrollHeight : null;
        setMessages(prev => {
          const ids = new Set(prev.map(m => m.id));
          return [...rows.filter(r => !ids.has(r.id)), ...prev];
        });
      }
    } catch { toast.error('Purane messages load nahi hue!'); }
    finally { setLoadingOlder(false); }
  };

  const handleSend = async () => {
    const body = text.trim();
    if (!body && !file && !task) return;
    setSending(true);
    try {
      let attachment = null;
      if (file) attachment = await uploadChatFile(file);
      const msg = {
        id: uuidv4(),
        sender_id: String(me.id || ''),
        sender_name: String(me.name || ''),
        sender_role: me.role,
        sender_color: me.color || '#3B82F6',
        body,
        task_id: task ? String(task.id) : null,
        task_name: task ? String(task.task_name || '') : null,
        task_employee: task ? String(task.employee_name || '') : null,
        task_date: task ? String(task.date).substring(0, 10) : null,
        task_status: task ? String(task.status || '') : null,
        attachment_url: attachment?.url || null,
        attachment_name: attachment?.name || null,
        attachment_type: attachment?.type || null,
      };
      await sendMessage(msg);
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, created_at: new Date().toISOString() }]);
      setText(''); setFile(null); setTask(null); setPickingTask(false);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      console.error('sendMessage error:', err);
      toast.error(`Message nahi gaya! ${err?.message || ''}`);
    } finally { setSending(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) handleSend(); }
  };

  const isMine = (m) => m.sender_role === me.role && String(m.sender_id) === String(me.id || '');
  const pickable = [...tasks]
    .filter(t => String(t.task_name || '').trim())
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 60);

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button onClick={() => setOpen(true)}
          style={{ position:'fixed',right:'20px',bottom:'20px',zIndex:200,padding:'13px 20px',background:brandButtonGradient,color:'white',border:`2px solid ${BRAND.yellow}`,borderRadius:'30px',cursor:'pointer',fontWeight:'800',fontSize:'14px',boxShadow:'0 6px 20px rgba(30,27,78,0.4)' }}>
          💬 Team Chat
        </button>
      )}

      {open && (
        <div style={{ position:'fixed',right:'16px',bottom:'16px',zIndex:200,width:'min(380px, calc(100vw - 32px))',height:'min(560px, calc(100vh - 32px))',background:'white',borderRadius:'18px',boxShadow:'0 12px 40px rgba(0,0,0,0.25)',display:'flex',flexDirection:'column',overflow:'hidden' }}>
          {/* Header */}
          <div style={{ background:brandButtonGradient,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
            <div>
              <div style={{ color:'white',fontWeight:'800',fontSize:'15px' }}>💬 Team Chat</div>
              <div style={{ color:'#a5b4fc',fontSize:'11px' }}>Poori team aur manager</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background:'rgba(255,255,255,0.12)',color:'white',border:'none',borderRadius:'8px',padding:'6px 10px',cursor:'pointer',fontWeight:'700' }}>✕</button>
          </div>

          {/* Messages */}
          <div ref={listRef} style={{ flex:1,overflowY:'auto',padding:'14px',background:'#f1f5f9' }}>
            {!loaded && <p style={{ textAlign:'center',color:'#94a3b8',fontSize:'13px' }}>Loading...</p>}
            {loaded && hasMore && (
              <div style={{ textAlign:'center',marginBottom:'12px' }}>
                <button onClick={loadOlder} disabled={loadingOlder}
                  style={{ padding:'6px 14px',background:'white',color:BRAND.navyLight,border:'1px solid #e2e8f0',borderRadius:'14px',cursor:loadingOlder?'not-allowed':'pointer',fontWeight:'700',fontSize:'12px' }}>
                  {loadingOlder ? '⏳ Loading...' : '⬆ Purane messages load karein'}
                </button>
              </div>
            )}
            {loaded && messages.length === 0 && (
              <div style={{ textAlign:'center',padding:'40px 10px',color:'#94a3b8' }}>
                <div style={{ fontSize:'36px',marginBottom:'8px' }}>💬</div>
                <p style={{ fontSize:'13px' }}>Abhi koi message nahi — pehla message bhejein!</p>
              </div>
            )}
            {messages.map(m => {
              const mine = isMine(m);
              const isManager = m.sender_role === 'manager';
              const isImage = String(m.attachment_type || '').startsWith('image/');
              const isVideo = String(m.attachment_type || '').startsWith('video/');
              return (
                <div key={m.id} style={{ display:'flex',justifyContent:mine?'flex-end':'flex-start',marginBottom:'10px' }}>
                  <div style={{ maxWidth:'82%',background:mine?BRAND.navy:'white',color:mine?'white':'#1e293b',borderRadius:mine?'14px 14px 4px 14px':'14px 14px 14px 4px',padding:'8px 12px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)' }}>
                    {!mine && (
                      <div style={{ fontSize:'11px',fontWeight:'800',color:m.sender_color || '#3B82F6',marginBottom:'3px',display:'flex',alignItems:'center',gap:'5px' }}>
                        {m.sender_name}
                        {isManager && <span style={{ background:BRAND.yellow,color:BRAND.navy,fontSize:'9px',padding:'1px 6px',borderRadius:'6px' }}>Manager</span>}
                      </div>
                    )}

                    {m.task_name && (
                      <div onClick={() => onTaskClick && onTaskClick(m)}
                        style={{ borderLeft:`3px solid ${STATUS_COLOR[m.task_status] || '#6B7280'}`,background:mine?'rgba(255,255,255,0.1)':'#f8fafc',borderRadius:'6px',padding:'6px 8px',marginBottom:'6px',fontSize:'12px',cursor:onTaskClick?'pointer':'default' }}>
                        <div style={{ fontWeight:'700' }}>📋 {m.task_name}</div>
                        <div style={{ fontSize:'10px',opacity:0.75 }}>{m.task_employee} · {m.task_date}{m.task_status ? ` · ${m.task_status}` : ''}</div>
                      </div>
                    )}

                    {m.attachment_url && (
                      isImage ? (
                        <a href={m.attachment_url} target="_blank" rel="noreferrer">
                          <img src={m.attachment_url} alt={m.attachment_name || ''} style={{ maxWidth:'100%',maxHeight:'200px',borderRadius:'8px',display:'block',marginBottom:'6px' }}/>
                        </a>
                      ) : isVideo ? (
                        <video src={m.attachment_url} controls style={{ maxWidth:'100%',maxHeight:'200px',borderRadius:'8px',display:'block',marginBottom:'6px' }}/>
                      ) : (
                        <a href={m.attachment_url} target="_blank" rel="noreferrer"
                          style={{ display:'block',fontSize:'12px',fontWeight:'700',color:mine?BRAND.yellow:BRAND.navyLight,marginBottom:'6px',wordBreak:'break-all' }}>
                          📎 {m.attachment_name || 'File'}
                        </a>
                      )
                    )}

                    {m.body && <div style={{ fontSize:'13px',whiteSpace:'pre-wrap',wordBreak:'break-word' }}>{m.body}</div>}
                    <div style={{ fontSize:'10px',opacity:0.6,marginTop:'3px',textAlign:'right' }}>{fmtTime(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Task picker */}
          {pickingTask && (
            <div style={{ maxHeight:'180px',overflowY:'auto',borderTop:'1px solid #e2e8f0',background:'white' }}>
              {pickable.length === 0 ? (
                <p style={{ padding:'12px',fontSize:'12px',color:'#94a3b8',textAlign:'center' }}>Koi task nahi</p>
              ) : pickable.map(t => (
                <div key={t.id} onClick={() => { setTask(t); setPickingTask(false); }}
                  onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}
                  style={{ padding:'8px 12px',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',color:'#1e293b' }}>
                  <span style={{ display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:STATUS_COLOR[t.status] || '#6B7280',marginRight:'6px' }}/>
                  {taskLabel(t)}
                </div>
              ))}
            </div>
          )}

          {/* Pending attachments */}
          {(task || file) && (
            <div style={{ padding:'8px 12px 0',display:'flex',gap:'6px',flexWrap:'wrap',background:'white',borderTop:'1px solid #e2e8f0' }}>
              {task && (
                <span style={{ background:'#EDE9FE',color:'#5B21B6',fontSize:'11px',fontWeight:'700',padding:'4px 8px',borderRadius:'8px',maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                  📋 {taskLabel(task)} <span onClick={() => setTask(null)} style={{ cursor:'pointer',marginLeft:'4px' }}>✕</span>
                </span>
              )}
              {file && (
                <span style={{ background:'#E0F2FE',color:'#0369a1',fontSize:'11px',fontWeight:'700',padding:'4px 8px',borderRadius:'8px',maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                  📎 {file.name} <span onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} style={{ cursor:'pointer',marginLeft:'4px' }}>✕</span>
                </span>
              )}
            </div>
          )}

          {/* Composer */}
          <div style={{ padding:'10px 12px',display:'flex',gap:'6px',alignItems:'flex-end',background:'white',borderTop:(task||file)?'none':'1px solid #e2e8f0' }}>
            <input ref={fileRef} type="file" style={{ display:'none' }} onChange={e => {
              const f = e.target.files[0]; if (!f) return;
              if (f.size > 10 * 1024 * 1024) { toast.error('File 10MB se choti honi chahiye!'); e.target.value = ''; return; }
              setFile(f);
            }}/>
            <button title="File / image" onClick={() => fileRef.current && fileRef.current.click()}
              style={{ padding:'9px',background:'#f1f5f9',border:'none',borderRadius:'10px',cursor:'pointer',fontSize:'15px' }}>📎</button>
            <button title="Task link karein" onClick={() => setPickingTask(p => !p)}
              style={{ padding:'9px',background:pickingTask?'#EDE9FE':'#f1f5f9',border:'none',borderRadius:'10px',cursor:'pointer',fontSize:'15px' }}>📋</button>
            <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Message likho..." rows={1}
              style={{ flex:1,resize:'none',padding:'9px 12px',borderRadius:'10px',border:'2px solid #e2e8f0',outline:'none',fontSize:'13px',fontFamily:'inherit',maxHeight:'90px',color:'#1e293b' }}/>
            <button onClick={handleSend} disabled={sending || (!text.trim() && !file && !task)}
              style={{ padding:'9px 14px',background:sending?'#94a3b8':brandButtonGradient,color:'white',border:'none',borderRadius:'10px',cursor:sending?'not-allowed':'pointer',fontWeight:'800',fontSize:'13px' }}>
              {sending ? '⏳' : '➤'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
