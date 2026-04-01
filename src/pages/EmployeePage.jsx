import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { v4 as uuidv4 } from 'uuid';

// ─── constants ────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Briefed': '#6B7280', 'In Progress': '#3B82F6', 'Submitted': '#F59E0B',
  'Approved': '#10B981', 'Rejected': '#EF4444', 'Assigned': '#8B5CF6'
};

const URDU_AYAT = 'دیانت وہ ہے جو اُس وقت بھی قائم رہے جب کوئی دیکھ نہ رہا ہو — کیونکہ اللہ سب کچھ دیکھ رہا ہے۔';
// eslint-disable-next-line no-unused-vars
const AYAT_EN  = '"Integrity is what remains when no one is watching — because Allah sees everything."';

// ─── helpers ──────────────────────────────────────────────────────────────────
const todayLocal = () => new Date().toISOString().split('T')[0];

const formatDateLabel = (dateStr) =>
  new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

// safeTime: Google Sheets / Excel time → "HH:MM"
// Rule: 0 / "00:00" / "1899-12-30T00:00Z" = empty cell → return ''
function safeTime(val) {
  if (val === null || val === undefined || val === '' || val === 0 || val === '0') return '';
  const s = String(val).trim();
  if (!s || s === '0') return '';
  // Already HH:MM
  if (/^\d{1,2}:\d{2}$/.test(s)) return s === '00:00' ? '' : s;
  // HH:MM:SS
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    const t = s.substring(0, 5);
    return t === '00:00' ? '' : t;
  }
  // ISO datetime — 1899-12-30T09:00:00.000Z from Sheets
  if (s.includes('T') || (s.includes('-') && s.length > 7)) {
    const d = new Date(s);
    if (!isNaN(d)) {
      const h = d.getUTCHours(), m = d.getUTCMinutes();
      if (h === 0 && m === 0) return ''; // empty cell stored as midnight
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
  }
  // Excel numeric fraction (0 < n < 1)
  const n = parseFloat(s);
  if (!isNaN(n)) {
    if (n <= 0 || n >= 1) return '';
    const totalMin = Math.round(n * 24 * 60);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    if (h === 0 && m === 0) return '';
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  return '';
}

// Cross-midnight hours calc
const calcHours = (start, end, brk) => {
  if (!start || !end) return 0;
  let s = new Date('2000/01/01 ' + start);
  let e = new Date('2000/01/01 ' + end);
  if (e <= s) e = new Date('2000/01/02 ' + end); // next-day wrap
  return Math.max(0, parseFloat(((e - s) / 3600000 - Number(brk) / 60).toFixed(2)));
};

// Night shift detection: office_in >= 18:00
const isNightShift = (officeIn) => !!officeIn && parseInt(officeIn.split(':')[0], 10) >= 18;
const nightLabel   = (officeIn, officeOut) => {
  if (!isNightShift(officeIn)) return null;
  const outH = officeOut ? parseInt(officeOut.split(':')[0], 10) : null;
  return outH !== null && outH < 12
    ? `${officeIn} (رات) → ${officeOut} (صبح اگلے دن)`
    : `${officeIn} — Night Shift`;
};

// FIX 2 (date logic): date is determined by office_in time, NOT calendar day
// If raat 22:00 se agle din 04:00 tak → selectedDate wali date use hoti hai
// Employee khud date select karta hai — wahi date use hogi

const getMonthDates = () => {
  const now = new Date(), yr = now.getFullYear(), mo = now.getMonth();
  const last = new Date(yr, mo + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) => new Date(yr, mo, i + 1).toISOString().split('T')[0]);
};
const getWeekDates = () => {
  const now = new Date(), day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d.toISOString().split('T')[0]; });
};

// localStorage cache
const readCache  = (type, uid) => { try { const r = localStorage.getItem(`emp_${type}_${uid}`); return r ? JSON.parse(r) : null; } catch { return null; } };
const writeCache = (type, uid, data) => { try { localStorage.setItem(`emp_${type}_${uid}`, JSON.stringify(data)); } catch {} };

const newTask = () => ({
  id: uuidv4(), task_name: '', start_time: '', end_time: '',
  break_time: 0, productive_hours: 0, status: 'Briefed', notes: '', is_assigned: false
});

// ─── component ────────────────────────────────────────────────────────────────
export default function EmployeePage() {
  const navigate  = useNavigate();
  const user      = JSON.parse(localStorage.getItem('user') || 'null');
  const today     = todayLocal();

  const [clock, setClock]               = useState('');
  const [activeTab, setActiveTab]       = useState('today');
  const [summaryType, setSummaryType]   = useState('monthly');
  const [selectedDate, setSelectedDate] = useState(today);
  const [officeIn, setOfficeIn]         = useState('');
  const [officeOut, setOfficeOut]       = useState('');
  // FIX 3: tasks are individually locked — NOT entire page
  // submitted = true means the DAY log was submitted (office in/out locked)
  // each task has its own lock based on status
  const [submitted, setSubmitted]       = useState(false);
  const [tasks, setTasks]               = useState([newTask()]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [photo, setPhoto]               = useState(user?.photo || '');

  const allLogsRef  = useRef([]);
  const allTasksRef = useRef([]);
  const [allLogs, setAllLogs]           = useState([]);
  const [allTasksData, setAllTasksData] = useState([]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })), 1000);
    return () => clearInterval(t);
  }, []);

  // FIX 3: task-level lock — submitted/approved/rejected tasks are locked
  // New tasks can always be added regardless
  const isTaskLocked = (task) =>
    task.status === 'Submitted' || task.status === 'Approved' || task.status === 'Rejected';

  const applyDateData = useCallback((dateToLoad, logs, tasksList) => {
    const dayLog = logs.find(l => String(l.date).substring(0, 10) === dateToLoad);
    if (dayLog) {
      setOfficeIn(safeTime(dayLog.office_in));
      setOfficeOut(safeTime(dayLog.office_out));
      const sub = dayLog.submitted;
      setSubmitted(sub === true || sub === 'TRUE' || sub === 'true' || sub === 1 || sub === '1');
    } else {
      setOfficeIn(''); setOfficeOut(''); setSubmitted(false);
    }
    const dayTasks = tasksList.filter(t => String(t.date).substring(0, 10) === dateToLoad);
    setTasks(dayTasks.length > 0
      ? dayTasks.map(t => ({
          id: String(t.id || uuidv4()),
          task_name: String(t.task_name || ''),
          start_time: safeTime(t.start_time),
          end_time: safeTime(t.end_time),
          break_time: Number(t.break_time) || 0,
          productive_hours: Number(t.productive_hours) || 0,
          status: String(t.status || 'Briefed'),
          notes: String(t.notes || ''),
          manager_note: String(t.manager_note || ''),
          is_assigned: t.is_assigned === true || t.is_assigned === 'true' || t.is_assigned === 'TRUE'
        }))
      : [newTask()]
    );
  }, []);

  const loadData = useCallback(async () => {
    if (!user) { navigate('/login'); return; }
    // Show cache immediately
    const cl = readCache('logs', user.id) || [], ct = readCache('tasks', user.id) || [];
    if (cl.length || ct.length) {
      allLogsRef.current = cl; allTasksRef.current = ct;
      setAllLogs(cl); setAllTasksData(ct);
      applyDateData(today, cl, ct);
      setLoading(false);
    }
    try {
      const [logsData, tasksData] = await Promise.all([api.get({ action: 'getDailyLogs' }), api.get({ action: 'getTasks' })]);
      const norm = (v) => String(v || '').trim().toLowerCase();
      const myLogs = Array.isArray(logsData)
        ? logsData.filter(l => norm(l.employee_id) === norm(user.id) || norm(l.employee_name) === norm(user.name))
            .map(l => ({ ...l, date: String(l.date || '').substring(0, 10), office_in: safeTime(l.office_in), office_out: safeTime(l.office_out) }))
        : cl;
      const myTasks = Array.isArray(tasksData)
        ? tasksData.filter(t => norm(t.employee_id) === norm(user.id) || norm(t.employee_name) === norm(user.name))
            .map(t => ({ ...t, date: String(t.date || '').substring(0, 10), start_time: safeTime(t.start_time), end_time: safeTime(t.end_time) }))
        : ct;
      const mLogs  = [...myLogs, ...cl.filter(c => !myLogs.some(l => l.date === c.date))];
      const mTasks = [...myTasks, ...ct.filter(c => !myTasks.some(t => t.id === c.id))];
      writeCache('logs', user.id, mLogs); writeCache('tasks', user.id, mTasks);
      allLogsRef.current = mLogs; allTasksRef.current = mTasks;
      setAllLogs(mLogs); setAllTasksData(mTasks);
      applyDateData(today, mLogs, mTasks);
    } catch { if (!cl.length) toast.error('Data load nahi hua!'); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { loadData(); }, []); // eslint-disable-line

  const handleDateChange = (d) => { setSelectedDate(d); applyDateData(d, allLogsRef.current, allTasksRef.current); };

  const updateTask = (id, field, value) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id || isTaskLocked(t)) return t;
      const updated = { ...t, [field]: value };
      updated.productive_hours = calcHours(
        field === 'start_time' ? value : t.start_time,
        field === 'end_time'   ? value : t.end_time,
        field === 'break_time' ? Number(value) : Number(t.break_time)
      );
      return updated;
    }));
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 1024 * 1024) { toast.error('Photo 1MB se choti honi chahiye!'); return; }
    const toastId = toast.loading('Photo upload...');
    const reader = new FileReader();
    reader.onload = async () => {
      setPhoto(reader.result);
      await api.post({ action: 'uploadPhoto', employee_id: user.id, photo_base64: reader.result });
      localStorage.setItem('user', JSON.stringify({ ...user, photo: reader.result }));
      toast.success('Photo update ho gayi! ✅', { id: toastId });
    };
    reader.readAsDataURL(file);
  };

  // FIX 3: handleSubmit — office in/out + NEW tasks submit
  // Already-locked tasks (Submitted/Approved/Rejected) are re-saved as-is
  const handleSubmit = async () => {
    if (!officeIn || !officeOut) { toast.error('Office In/Out time zaruri hai!'); return; }
    // Only validate new (unlocked) tasks
    const unlockedTasks = tasks.filter(t => !isTaskLocked(t) && t.task_name && t.task_name.trim());
    const allNamedTasks = tasks.filter(t => t.task_name && t.task_name.trim());
    if (allNamedTasks.length === 0) { toast.error('Kam se kam ek task naam chahiye!'); return; }
    if (unlockedTasks.some(t => !t.start_time || !t.end_time)) { toast.error('Naye tasks mein start/end time daalen!'); return; }
    if (!window.confirm('Submit karne ke baad office time aur yeh tasks lock ho jaenge. Sure hain?')) return;

    setSaving(true);
    try {
      const empId = String(user.id), empName = String(user.name);
      const total = parseFloat(allNamedTasks.reduce((s, t) => s + Number(t.productive_hours), 0).toFixed(2));
      // Submit day log
      await api.post({
        action: 'submitDay', employee_id: empId, date: selectedDate,
        data: { id: `${empId}_${selectedDate}`, employee_id: empId, employee_name: empName, date: selectedDate, office_in: officeIn, office_out: officeOut, total_productive_hours: total, submitted: true }
      });
      // Save only unlocked (new) tasks — already-submitted ones stay as-is
      for (const task of unlockedTasks) {
        await api.post({
          action: 'saveTask',
          data: {
            id: task.id, daily_log_id: `${empId}_${selectedDate}`, employee_id: empId,
            employee_name: empName, date: selectedDate, task_name: String(task.task_name),
            start_time: String(task.start_time), end_time: String(task.end_time),
            break_time: Number(task.break_time) || 0, productive_hours: Number(task.productive_hours) || 0,
            status: 'Submitted', notes: String(task.notes || ''), manager_note: '',
            is_assigned: task.is_assigned ? 'true' : 'false'
          }
        });
      }
      // Update cache
      const newLog = { employee_id: empId, employee_name: empName, date: selectedDate, office_in: officeIn, office_out: officeOut, submitted: true, total_productive_hours: total };
      const updatedTasks = tasks.map(t =>
        isTaskLocked(t) ? t : { ...t, employee_id: empId, employee_name: empName, date: selectedDate, status: 'Submitted' }
      );
      const updatedLogs = [...allLogsRef.current.filter(l => !(String(l.date).substring(0,10)===selectedDate && String(l.employee_id)===empId)), newLog];
      const mergedTasks = [...allTasksRef.current.filter(t => !(String(t.date).substring(0,10)===selectedDate && String(t.employee_id)===empId)), ...updatedTasks.filter(t => t.task_name)];
      writeCache('logs', empId, updatedLogs); writeCache('tasks', empId, mergedTasks);
      allLogsRef.current = updatedLogs; allTasksRef.current = mergedTasks;
      setAllLogs(updatedLogs); setAllTasksData(mergedTasks);
      setSubmitted(true); setTasks(updatedTasks);
      toast.success('🎉 Kaam submit ho gaya!');
    } catch { toast.error('Submit nahi hua! Dobara try karein.'); }
    finally { setSaving(false); }
  };

  const logout = () => { localStorage.removeItem('user'); navigate('/login'); };

  const totalHrs     = tasks.reduce((s, t) => s + Number(t.productive_hours), 0).toFixed(2);
  const nLabel       = nightLabel(officeIn, officeOut);
  // eslint-disable-next-line no-unused-vars
  const hasNewTasks  = tasks.some(t => !isTaskLocked(t));
  // eslint-disable-next-line no-unused-vars
  const canSubmit    = !submitted && selectedDate === today;

  // Summary
  const getSummaryDates = () => summaryType === 'daily' ? [today] : summaryType === 'weekly' ? getWeekDates() : getMonthDates();
  const summaryDates    = getSummaryDates();
  const summaryLogs     = allLogs.filter(l => summaryDates.includes(String(l.date).substring(0, 10)));
  const summaryTasks    = allTasksData.filter(t => summaryDates.includes(String(t.date).substring(0, 10)));
  const summaryTotalHrs = summaryTasks.reduce((s, t) => s + Number(t.productive_hours || 0), 0).toFixed(1);
  const summaryDaysWorked = new Set(summaryLogs.filter(l => l.submitted === true || l.submitted === 'TRUE' || l.submitted === 'true').map(l => String(l.date).substring(0, 10))).size;

  if (loading) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',flexDirection:'column',gap:'16px',background:'#f1f5f9' }}>
      <div style={{ width:'44px',height:'44px',border:'4px solid #e2e8f0',borderTop:'4px solid #4a90d9',borderRadius:'50%',animation:'spin 1s linear infinite' }}/>
      <p style={{ color:'#64748b' }}>Loading...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh',background:'#f1f5f9' }}>

      {/* ══ HEADER ══ */}
      <div style={{ background:'linear-gradient(135deg,#0f172a,#1e3a5f)',position:'sticky',top:0,zIndex:100,boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>
        <div style={{ maxWidth:'860px',margin:'0 auto',padding:'0 20px' }}>

          {/* FIX 4: Urdu ayat at the TOP of header */}
          <div style={{ padding:'10px 0 8px',borderBottom:'1px solid rgba(255,255,255,0.08)',textAlign:'center' }}>
            <div style={{ fontFamily:"'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif",direction:'rtl',fontSize:'15px',color:'#a5b4fc',lineHeight:'2',fontWeight:'600',letterSpacing:'0.01em' }}>
              {URDU_AYAT}
            </div>
          </div>

          {/* Name + Clock row */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0 8px' }}>
            <div style={{ display:'flex',alignItems:'center',gap:'12px' }}>
              <label style={{ cursor:'pointer',position:'relative',flexShrink:0 }}>
                <div style={{ width:'46px',height:'46px',borderRadius:'50%',background:user?.color||'#3B82F6',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',fontWeight:'800',border:'3px solid rgba(255,255,255,0.25)' }}>
                  {photo ? <img src={photo} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/> : user?.name?.[0]}
                </div>
                <div style={{ position:'absolute',bottom:'-2px',right:'-2px',background:'#4a90d9',borderRadius:'50%',width:'16px',height:'16px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'8px',border:'2px solid #0f172a' }}>📷</div>
                <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display:'none' }}/>
              </label>
              <div>
                <h2 style={{ color:'white',fontWeight:'800',fontSize:'15px' }}>{user?.name}</h2>
                <p style={{ color:'#94a3b8',fontSize:'11px' }}>{user?.designation}</p>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ color:'#4a90d9',fontSize:'17px',fontWeight:'900',fontFamily:'monospace' }}>{clock}</div>
              <button onClick={logout} style={{ marginTop:'4px',padding:'3px 10px',background:'rgba(255,255,255,0.08)',color:'#94a3b8',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'6px',cursor:'pointer',fontSize:'11px' }}>Logout</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex',gap:'4px',alignItems:'center',paddingBottom:'10px' }}>
            {[['today','📋 Today Work'],['summary','📊 Summary']].map(([t, label]) => (
              <button key={t} onClick={() => setActiveTab(t)} style={{ padding:'7px 16px',border:'none',cursor:'pointer',fontSize:'12px',fontWeight:'700',background:activeTab===t?'rgba(255,255,255,0.15)':'transparent',color:activeTab===t?'white':'#64748b',borderRadius:'8px',borderBottom:activeTab===t?'2px solid #4a90d9':'2px solid transparent' }}>{label}</button>
            ))}
            {/* FIX 3: show lock only for office time, not whole page */}
            {submitted && activeTab==='today' && (
              <span style={{ marginLeft:'auto',background:'rgba(245,158,11,0.2)',color:'#F59E0B',padding:'4px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'700' }}>🔒 Office Time Locked</span>
            )}
          </div>
        </div>
      </div>

      {/* ══ CONTENT ══ */}
      <div style={{ maxWidth:'860px',margin:'0 auto',padding:'20px' }}>

        {/* ═══ TODAY TAB ═══ */}
        {activeTab === 'today' && (
          <div>
            {/* Assigned task notice */}
            {tasks.some(t => t.is_assigned) && (
              <div style={{ background:'#EDE9FE',border:'2px solid #8B5CF6',borderRadius:'12px',padding:'12px 16px',marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px' }}>
                <span>📌</span>
                <p style={{ color:'#5B21B6',fontWeight:'700',fontSize:'13px' }}>Manager ne aapko tasks assign kiye hain!</p>
              </div>
            )}

            <div style={{ background:'white',borderRadius:'18px',padding:'22px',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',marginBottom:'16px' }}>

              {/* DATE SELECTOR */}
              <div style={{ marginBottom:'18px',paddingBottom:'18px',borderBottom:'2px solid #f1f5f9' }}>
                <label style={{ fontWeight:'700',display:'block',marginBottom:'8px',fontSize:'13px',color:'#475569' }}>📅 Date Select Karein</label>
                <div style={{ display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap' }}>
                  <input type="date" value={selectedDate} max={today} onChange={e => handleDateChange(e.target.value)}
                    style={{ padding:'10px 14px',borderRadius:'10px',border:'2px solid #cbd5e1',fontSize:'14px',outline:'none',background:'white',color:'#1e293b',fontWeight:'600',cursor:'pointer' }}/>
                  <span style={{ fontSize:'14px',color:'#475569',fontWeight:'700' }}>{formatDateLabel(selectedDate)}</span>
                  {selectedDate < today && <span style={{ background:'#FEF2F2',color:'#EF4444',padding:'3px 10px',borderRadius:'10px',fontSize:'11px',fontWeight:'700' }}>📅 Past Date</span>}
                </div>
                {/* FIX 2: Night shift note */}
                <p style={{ marginTop:'8px',fontSize:'11px',color:'#94a3b8' }}>
                  💡 Raat ke kaam (10 PM – 4 AM) ke liye — us date ko select karein jab kaam shuru kiya
                </p>
              </div>

              {/* ATTENDANCE */}
              <div style={{ marginBottom:'20px',paddingBottom:'18px',borderBottom:'2px solid #f1f5f9' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px' }}>
                  <h3 style={{ fontWeight:'800',color:'#0f172a',fontSize:'14px' }}>🗓 Attendance</h3>
                  {submitted && <span style={{ background:'#FEF3C7',color:'#92400E',fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'10px' }}>🔒 Office time locked</span>}
                </div>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px' }}>
                  {[['🕐 Office In', officeIn, setOfficeIn], ['🕐 Office Out', officeOut, setOfficeOut]].map(([label, val, setter]) => (
                    <div key={label}>
                      <label style={{ fontWeight:'700',display:'block',marginBottom:'6px',fontSize:'12px',color:'#475569' }}>{label}</label>
                      <input type="time" value={val} onChange={e => { if (!submitted) setter(e.target.value); }} disabled={submitted}
                        style={{ width:'100%',padding:'10px',borderRadius:'10px',border:`2px solid ${submitted?'#e2e8f0':'#cbd5e1'}`,fontSize:'15px',outline:'none',background:submitted?'#f8fafc':'white',color:'#1e293b' }}/>
                    </div>
                  ))}
                </div>

                {/* Night shift badge */}
                {nLabel && (
                  <div style={{ marginTop:'10px',padding:'10px 14px',background:'linear-gradient(135deg,#1e1b4b,#312e81)',borderRadius:'10px',display:'flex',alignItems:'center',gap:'10px' }}>
                    <span style={{ fontSize:'18px' }}>🌙</span>
                    <div>
                      <p style={{ color:'#a5b4fc',fontSize:'12px',fontWeight:'700' }}>Night Shift Detected</p>
                      <p style={{ color:'#c7d2fe',fontSize:'11px' }}>{nLabel}</p>
                      <p style={{ color:'#818cf8',fontSize:'10px',marginTop:'2px' }}>
                        Yeh shift "{formatDateLabel(selectedDate)}" ke record mein save hogi
                      </p>
                    </div>
                  </div>
                )}

                {officeIn && officeOut && (
                  <div style={{ marginTop:'10px',padding:'8px 14px',background:'#f0f9ff',borderRadius:'8px',display:'flex',justifyContent:'space-between' }}>
                    <span style={{ color:'#0369a1',fontSize:'12px',fontWeight:'600' }}>📍 Total Office Hours</span>
                    <span style={{ color:'#0369a1',fontSize:'12px',fontWeight:'800' }}>
                      {(() => {
                        let s = new Date('2000/01/01 ' + officeIn), e = new Date('2000/01/01 ' + officeOut);
                        if (e <= s) e = new Date('2000/01/02 ' + officeOut);
                        return Math.max(0, (e - s) / 3600000).toFixed(1) + ' hrs';
                      })()}
                    </span>
                  </div>
                )}
              </div>

              {/* ─── TASKS ─── */}
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px' }}>
                <h3 style={{ fontWeight:'800',color:'#0f172a',fontSize:'14px' }}>✅ Tasks</h3>
                {/* FIX 3: Show how many are locked vs editable */}
                {tasks.some(t => isTaskLocked(t)) && (
                  <span style={{ fontSize:'11px',color:'#F59E0B',fontWeight:'600',background:'#FEF3C7',padding:'3px 10px',borderRadius:'8px' }}>
                    🔒 {tasks.filter(t => isTaskLocked(t)).length} task(s) locked
                  </span>
                )}
              </div>

              {tasks.length === 0 && (
                <p style={{ color:'#94a3b8',textAlign:'center',padding:'20px',fontStyle:'italic',fontSize:'13px' }}>Is date ka koi task nahi</p>
              )}

              {tasks.map((task, idx) => {
                const locked = isTaskLocked(task);
                // is_assigned can come as true, "true", "TRUE" from sheets
                const isAssigned = task.is_assigned === true || String(task.is_assigned).toLowerCase() === 'true';
                return (
                  <div key={task.id} style={{
                    border: `2px solid ${isAssigned ? '#C4B5FD' : (task.task_name ? '#e2e8f0' : '#fde68a')}`,
                    borderLeft: `4px solid ${isAssigned ? '#8B5CF6' : (STATUS_COLORS[task.status] || '#e2e8f0')}`,
                    borderRadius: '14px', padding: '16px', marginBottom: '14px',
                    background: locked ? '#fafafa' : isAssigned ? '#FAFAFF' : 'white',
                    opacity: locked ? 0.85 : 1
                  }}>
                    {/* Task header */}
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px',flexWrap:'wrap',gap:'6px' }}>
                      <div style={{ display:'flex',alignItems:'center',gap:'6px' }}>
                        <div style={{ width:'24px',height:'24px',borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#4a90d9)',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'900',fontSize:'11px',flexShrink:0 }}>{idx + 1}</div>
                        {isAssigned && <span style={{ background:'#EDE9FE',color:'#5B21B6',fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'10px' }}>📌 Manager ne assign kiya</span>}
                        {locked && <span style={{ background:(STATUS_COLORS[task.status]||'#6B7280')+'20',color:STATUS_COLORS[task.status]||'#6B7280',fontSize:'10px',fontWeight:'700',padding:'2px 8px',borderRadius:'10px' }}>🔒 {task.status}</span>}
                      </div>
                      <div style={{ display:'flex',alignItems:'center',gap:'4px',flexWrap:'wrap' }}>
                        {!locked && ['Briefed','In Progress'].map(s => (
                          <button key={s} onClick={() => updateTask(task.id, 'status', s)} style={{ padding:'4px 10px',borderRadius:'8px',border:'2px solid',borderColor:task.status===s?STATUS_COLORS[s]:'#e2e8f0',background:task.status===s?STATUS_COLORS[s]+'20':'white',color:task.status===s?STATUS_COLORS[s]:'#94a3b8',fontWeight:'700',fontSize:'10px',cursor:'pointer',whiteSpace:'nowrap' }}>{s}</button>
                        ))}
                        {!locked && tasks.filter(t => !isTaskLocked(t)).length > 1 && !isAssigned && (
                          <button onClick={() => setTasks(t => t.filter(x => x.id !== task.id))} style={{ background:'#FEE2E2',color:'#DC2626',border:'none',borderRadius:'6px',padding:'4px 8px',cursor:'pointer',fontSize:'11px',marginLeft:'4px' }}>🗑</button>
                        )}
                      </div>
                    </div>

                    {/* Task name — assigned tasks ka naam lock */}
                    <input type="text" placeholder="Task ka naam likho..." value={task.task_name}
                      onChange={e => updateTask(task.id, 'task_name', e.target.value)}
                      disabled={locked || isAssigned}
                      style={{ width:'100%',padding:'9px 12px',borderRadius:'9px',border:'2px solid #e2e8f0',marginBottom:'10px',fontSize:'14px',outline:'none',fontWeight:'600',background:(locked||isAssigned)?'#f8fafc':'white',color:'#1e293b',boxSizing:'border-box' }}/>

                    {/* Start / End / Break */}
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',marginBottom:'10px' }}>
                      {[['🕐 Start','start_time','time'],['🕐 End','end_time','time'],['☕ Break (mins)','break_time','number']].map(([lbl, field, type]) => (
                        <div key={field}>
                          <label style={{ fontSize:'10px',fontWeight:'700',color:'#64748b',display:'block',marginBottom:'4px' }}>{lbl}</label>
                          <input type={type} value={task[field]} min={type==='number'?0:undefined}
                            onChange={e => updateTask(task.id, field, e.target.value)} disabled={locked}
                            style={{ width:'100%',padding:'8px',borderRadius:'8px',border:'2px solid #e2e8f0',outline:'none',fontSize:'12px',background:locked?'#f8fafc':'white',color:'#1e293b',boxSizing:'border-box' }}/>
                        </div>
                      ))}
                    </div>

                    {/* Notes + Productive Hrs */}
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 140px',gap:'10px',alignItems:'start' }}>
                      <div>
                        <label style={{ fontSize:'10px',fontWeight:'700',color:'#64748b',display:'block',marginBottom:'4px' }}>📝 Notes</label>
                        <textarea placeholder="Notes..." value={task.notes}
                          onChange={e => updateTask(task.id, 'notes', e.target.value)} disabled={locked} rows={2}
                          style={{ width:'100%',padding:'8px 10px',borderRadius:'8px',border:'2px solid #e2e8f0',fontSize:'12px',outline:'none',resize:'vertical',background:locked?'#f8fafc':'white',color:'#475569',fontFamily:'inherit',boxSizing:'border-box' }}/>
                      </div>
                      <div>
                        <label style={{ fontSize:'10px',fontWeight:'700',color:'#10B981',display:'block',marginBottom:'4px' }}>⚡ Productive Hrs</label>
                        <div style={{ padding:'14px 8px',borderRadius:'8px',textAlign:'center',background:task.productive_hours>0?'linear-gradient(135deg,#D1FAE5,#A7F3D0)':'#f1f5f9',border:`2px solid ${task.productive_hours>0?'#A7F3D0':'#e2e8f0'}`,color:task.productive_hours>0?'#059669':'#94a3b8',fontWeight:'900',fontSize:'20px' }}>
                          {task.productive_hours} hrs
                        </div>
                      </div>
                    </div>

                    {/* Manager note */}
                    {isAssigned && task.notes && (
                      <div style={{ marginTop:'10px',padding:'8px 12px',background:'#EDE9FE',borderRadius:'8px',border:'1px solid #C4B5FD' }}>
                        <p style={{ fontSize:'11px',color:'#5B21B6',fontWeight:'700' }}>📋 Manager Instructions: {task.notes}</p>
                      </div>
                    )}
                    {task.manager_note && task.manager_note !== 'Assigned by Manager' && (
                      <div style={{ marginTop:'10px',padding:'8px 12px',background:'#FEF2F2',borderRadius:'8px',border:'1px solid #FECACA' }}>
                        <p style={{ fontSize:'11px',color:'#EF4444',fontWeight:'700' }}>💬 Manager: {task.manager_note}</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* FIX 3: Add task button — ALWAYS visible on today's date, even if some tasks are locked */}
              {selectedDate === today && (
                <button onClick={() => setTasks(t => [...t, newTask()])}
                  style={{ width:'100%',padding:'12px',border:'2px dashed #10B981',borderRadius:'12px',background:'#F0FDF4',color:'#059669',fontWeight:'700',fontSize:'14px',cursor:'pointer',marginBottom:'14px' }}>
                  + Naya Task Add Karein
                </button>
              )}

              {tasks.length > 0 && (
                <div style={{ padding:'14px',borderRadius:'12px',background:'linear-gradient(135deg,#1e3a5f,#0f172a)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                  <span style={{ color:'#94a3b8',fontWeight:'700',fontSize:'13px' }}>⚡ Total Productive Hrs</span>
                  <span style={{ color:'#4ade80',fontWeight:'900',fontSize:'22px' }}>{totalHrs} hrs</span>
                </div>
              )}
            </div>

            {/* FIX 3: Submit button — visible on today even if some tasks are already submitted
                Only submits NEW (unlocked) tasks + locks office time */}
            {selectedDate === today && (
              <button onClick={handleSubmit} disabled={saving}
                style={{ width:'100%',padding:'18px',background:saving?'#94a3b8':'linear-gradient(135deg,#DC2626,#EF4444)',color:'white',border:'none',borderRadius:'16px',fontWeight:'900',fontSize:'18px',cursor:saving?'not-allowed':'pointer',boxShadow:saving?'none':'0 8px 24px rgba(239,68,68,0.4)',marginBottom:'24px' }}>
                {saving ? '⏳ Submit ho raha hai...'
                  : submitted ? '🚀 Naye Tasks Submit Karein'
                  : '🚀 Submit My Day'}
              </button>
            )}
          </div>
        )}

        {/* ═══ SUMMARY TAB ═══ */}
        {activeTab === 'summary' && (
          <div>
            <div style={{ display:'flex',gap:'8px',marginBottom:'20px',background:'white',borderRadius:'14px',padding:'6px',boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
              {[['daily','📅 Daily'],['weekly','📆 Weekly'],['monthly','🗓 Monthly']].map(([type, label]) => (
                <button key={type} onClick={() => setSummaryType(type)} style={{ flex:1,padding:'10px',borderRadius:'10px',border:'none',background:summaryType===type?'linear-gradient(135deg,#1e3a5f,#4a90d9)':'transparent',color:summaryType===type?'white':'#64748b',fontWeight:'700',fontSize:'13px',cursor:'pointer' }}>{label}</button>
              ))}
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'14px',marginBottom:'20px' }}>
              {[['📅 Days Worked',summaryDaysWorked,'#4a90d9'],['⚡ Total Hrs',summaryTotalHrs,'#10B981'],['📋 Tasks',summaryTasks.filter(t=>t.task_name).length,'#8B5CF6']].map(([label,val,color]) => (
                <div key={label} style={{ background:'white',borderRadius:'14px',padding:'18px',textAlign:'center',boxShadow:'0 2px 8px rgba(0,0,0,0.06)',borderTop:`3px solid ${color}` }}>
                  <p style={{ color:'#94a3b8',fontSize:'11px',fontWeight:'600',marginBottom:'6px' }}>{label}</p>
                  <p style={{ fontSize:'26px',fontWeight:'900',color }}>{val}</p>
                </div>
              ))}
            </div>

            <div style={{ background:'white',borderRadius:'18px',padding:'20px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontWeight:'800',marginBottom:'16px',color:'#0f172a',fontSize:'15px' }}>
                {summaryType==='daily'?`📅 ${formatDateLabel(today)}`:summaryType==='weekly'?'📆 This Week':`🗓 ${new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'})}`}
              </h3>
              {summaryDates.filter(date => date <= today).reverse().map(date => {
                const log      = allLogs.find(l => String(l.date).substring(0, 10) === date);
                const dayTasks = allTasksData.filter(t => String(t.date).substring(0, 10) === date && t.task_name);
                if (!log && dayTasks.length === 0) return null;
                const isSubmitted = log?.submitted === true || log?.submitted === 'TRUE' || log?.submitted === 'true';
                const nl = log ? nightLabel(log.office_in, log.office_out) : null;
                return (
                  <div key={date} style={{ marginBottom:'12px',border:'2px solid #f1f5f9',borderRadius:'12px',overflow:'hidden' }}>
                    <div style={{ background:isSubmitted?'#1e3a5f':'#f1f5f9',padding:'10px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'6px' }}>
                      <div style={{ display:'flex',alignItems:'center',gap:'6px' }}>
                        <span style={{ color:isSubmitted?'white':'#64748b',fontWeight:'800',fontSize:'13px' }}>{formatDateLabel(date)}</span>
                        {nl && <span style={{ fontSize:'10px',background:'rgba(165,180,252,0.2)',color:'#a5b4fc',padding:'2px 6px',borderRadius:'6px' }}>🌙</span>}
                      </div>
                      <div style={{ display:'flex',gap:'12px',alignItems:'center' }}>
                        {log && <span style={{ color:isSubmitted?'#94a3b8':'#cbd5e1',fontSize:'11px' }}>In: {log.office_in||'--'} | Out: {log.office_out||'--'}</span>}
                        <span style={{ color:isSubmitted?'#4ade80':'#94a3b8',fontWeight:'900',fontSize:'14px' }}>⚡ {log?.total_productive_hours||0} hrs</span>
                        <span style={{ fontSize:'10px',fontWeight:'700',padding:'2px 8px',borderRadius:'8px',background:isSubmitted?'rgba(16,185,129,0.2)':'rgba(239,68,68,0.1)',color:isSubmitted?'#10B981':'#EF4444' }}>
                          {isSubmitted?'Submitted':'Pending'}
                        </span>
                      </div>
                    </div>
                    {dayTasks.length > 0 ? (
                      <div style={{ padding:'8px 16px' }}>
                        {dayTasks.map(t => (
                          <div key={t.id} style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'8px 0',borderBottom:'1px solid #f8fafc' }}>
                            <div style={{ flex:1 }}>
                              <p style={{ fontWeight:'700',fontSize:'13px',color:'#1e293b' }}>{t.task_name}</p>
                              {(t.start_time||t.end_time) && <p style={{ fontSize:'11px',color:'#64748b',marginTop:'1px' }}>{t.start_time} → {t.end_time}{t.break_time>0?` | Break: ${t.break_time}m`:''}</p>}
                              {t.notes && <p style={{ fontSize:'11px',color:'#94a3b8',marginTop:'2px' }}>📝 {t.notes}</p>}
                            </div>
                            <div style={{ textAlign:'right',flexShrink:0,marginLeft:'12px' }}>
                              <p style={{ fontWeight:'900',color:'#10B981',fontSize:'14px' }}>{t.productive_hours}h</p>
                              <span style={{ fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'8px',background:(STATUS_COLORS[t.status]||'#6B7280')+'20',color:STATUS_COLORS[t.status]||'#6B7280' }}>{t.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p style={{ padding:'8px 16px',color:'#cbd5e1',fontSize:'11px',fontStyle:'italic' }}>Koi tasks nahi</p>}
                  </div>
                );
              }).filter(Boolean)}
              {summaryDates.filter(d => d<=today && (allLogs.some(l=>String(l.date).substring(0,10)===d)||allTasksData.some(t=>String(t.date).substring(0,10)===d&&t.task_name))).length===0 && (
                <div style={{ textAlign:'center',padding:'40px',color:'#94a3b8' }}>
                  <div style={{ fontSize:'40px',marginBottom:'10px' }}>📭</div>
                  <p>Koi data nahi hai</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
