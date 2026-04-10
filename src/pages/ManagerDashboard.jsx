import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
// eslint-disable-next-line no-unused-vars
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend
} from 'recharts';
import toast from 'react-hot-toast';
import { api } from '../api';
import { v4 as uuidv4 } from 'uuid';

// ── helpers ──────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').trim().toLowerCase();
const todayStr = () => new Date().toISOString().split('T')[0];

const STATUS_COLOR = {
  'Briefed': '#6B7280', 'In Progress': '#3B82F6',
  'Submitted': '#F59E0B', 'Approved': '#10B981',
  'Rejected': '#EF4444', 'Assigned': '#8B5CF6'
};
const sColor = (s) => STATUS_COLOR[s] || '#6B7280';

const empMatch = (row, emp) => {
  const rid = norm(row.employee_id), rname = norm(row.employee_name);
  const eid = norm(emp.id), ename = norm(emp.name);
  if (eid && eid !== 'undefined' && rid && rid !== 'undefined' && rid === eid) return true;
  return rname === ename && ename.length > 0;
};

const getWeekRange = (ref) => {
  const d = new Date(ref + 'T00:00:00'), day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: mon.toISOString().split('T')[0], end: sun.toISOString().split('T')[0] };
};
const getMonthRange = (ref) => {
  const d = new Date(ref + 'T00:00:00');
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0],
    end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
  };
};
const getDatesInRange = (start, end) => {
  const dates = [], cur = new Date(start + 'T00:00:00'), last = new Date(end + 'T00:00:00');
  while (cur <= last) { dates.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate() + 1); }
  return dates;
};
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtMonth = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// ── formatTime: Google Sheets / Excel time value → "HH:MM" ───────────────
// Sheets returns time as:
//   "1899-12-30T09:00:00.000Z"  ISO with 1899 epoch date
//   0.375                        Excel serial fraction (0 = midnight/empty)
//   "09:00" / "09:00:00"         plain string
//   0 or ""                      empty cell → return ''
function formatTime(val) {
  // Strict empty check — 0 means empty cell in Sheets, not midnight
  if (val === null || val === undefined || val === '' || val === 0 || val === '0') return '';

  const s = String(val).trim();
  if (!s || s === '0') return '';

  // Already HH:MM — but reject "00:00" (empty cell stored as midnight)
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    return s === '00:00' ? '' : s;
  }
  // HH:MM:SS
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    const t = s.substring(0, 5);
    return t === '00:00' ? '' : t;
  }
  // ISO datetime string (handles 1899-12-30T09:00:00.000Z from Sheets)
  if (s.includes('T') || (s.includes('-') && s.length > 7)) {
    const d = new Date(s);
    if (!isNaN(d)) {
      const h = d.getUTCHours(), m = d.getUTCMinutes();
      // 1899-12-30T00:00:00Z = empty cell in Sheets
      if (h === 0 && m === 0) return '';
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
  }
  // Excel numeric time fraction (0.0 – 0.9999)
  // 0 = midnight = empty cell; skip it
  const n = parseFloat(s);
  if (!isNaN(n)) {
    if (n <= 0 || n >= 1) return ''; // 0 = empty, >=1 = date serial not time
    const totalMin = Math.round(n * 24 * 60);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    if (h === 0 && m === 0) return '';
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  return '';
}

export default function ManagerDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('dashboard');
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Analytics
  const [analyticsEmp, setAnalyticsEmp] = useState('all');
  const [analyticsPeriod, setAnalyticsPeriod] = useState('weekly');
  const [analyticsRef, setAnalyticsRef] = useState(todayStr());

  // Data
  const allLogsRef = useRef([]);
  const allTasksRef = useRef([]);
  const [employees, setEmployees] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [allTasks, setAllTasks] = useState([]);

  // Add employee
  const [newEmp, setNewEmp] = useState({ name: '', designation: '', password: '', color: '#3B82F6' });
  const [addingEmp, setAddingEmp] = useState(false);

  // Assign task modal — NO start/end/break fields
  const [assignModal, setAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignForm, setAssignForm] = useState({ task_name: '', date: todayStr(), notes: '' });
  const [assigning, setAssigning] = useState(false);

  // Password
  const [managerPass, setManagerPass] = useState({ old: '', new1: '', new2: '' });
  const [changingPass, setChangingPass] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      let emps = [], logs = [], tasks = [];
      try {
        const dash = await api.get({ action: 'getDashboardData' });
        if (dash?.employees) { emps = dash.employees; logs = dash.logs || []; tasks = dash.tasks || []; }
        else throw new Error();
      } catch {
        const [l, t, e] = await Promise.all([
          api.get({ action: 'getDailyLogs' }),
          api.get({ action: 'getTasks' }),
          api.get({ action: 'getEmployees' })
        ]);
        emps = Array.isArray(e) ? e : [];
        logs = Array.isArray(l) ? l : [];
        tasks = Array.isArray(t) ? t : [];
      }

      const parsedLogs = logs.filter(l => l.employee_name && l.date).map(l => ({
        ...l,
        employee_id: String(l.employee_id || '').trim(),
        employee_name: String(l.employee_name || '').trim(),
        date: String(l.date || '').substring(0, 10),
        submitted: l.submitted === true || String(l.submitted).toUpperCase() === 'TRUE',
        total_productive_hours: Number(l.total_productive_hours) || 0,
        office_in: formatTime(l.office_in),
        office_out: formatTime(l.office_out),
      }));

      const parsedTasks = tasks.filter(t => t.id && String(t.task_name || '').trim()).map(t => ({
        ...t,
        employee_id: String(t.employee_id || '').trim(),
        employee_name: String(t.employee_name || '').trim(),
        date: String(t.date || '').substring(0, 10),
        task_name: String(t.task_name || '').trim(),
        status: String(t.status || 'Briefed').trim(),
        productive_hours: Number(t.productive_hours) || 0,
        break_time: Number(t.break_time) || 0,
        is_assigned: t.is_assigned === true || String(t.is_assigned).toLowerCase() === 'true',
        start_time: formatTime(t.start_time),
        end_time: formatTime(t.end_time),
      }));

      allLogsRef.current = parsedLogs;
      allTasksRef.current = parsedTasks;
      setAllLogs(parsedLogs);
      setAllTasks(parsedTasks);
      setEmployees(Array.isArray(emps) ? emps.filter(e => e.name) : []);
      setLastUpdated(new Date().toLocaleTimeString('en-US', { hour12: true }));
    } catch { toast.error('Data load error!'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(() => loadData(true), 60000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const dayLogs = allLogs.filter(l => l.date === selectedDate);
  const dayTasks = allTasks.filter(t => t.date === selectedDate);
  const getLog = (emp) => dayLogs.find(l => empMatch(l, emp));
  const getEmpTasks = (emp) => dayTasks.filter(t => empMatch(t, emp));

  const submittedCount = employees.filter(e => getLog(e)?.submitted).length;
  const pendingCount = employees.length - submittedCount;
  const totalHrs = dayLogs.reduce((s, l) => s + l.total_productive_hours, 0).toFixed(1);

  // ── Actions ───────────────────────────────────────────────────────────────
  const approveTask = async (taskId) => {
    const note = prompt('Manager note (optional):') || '';
    try {
      await api.post({ action: 'approveTask', task_id: taskId, note });
      const updated = allTasksRef.current.map(t => t.id === taskId ? { ...t, status: 'Approved', manager_note: note } : t);
      allTasksRef.current = updated; setAllTasks([...updated]);
      toast.success('✅ Approved!');
    } catch { toast.error('Error!'); }
  };

  const rejectTask = async (taskId) => {
    const note = prompt('Rejection reason:') || '';
    try {
      await api.post({ action: 'rejectTask', task_id: taskId, note });
      const updated = allTasksRef.current.map(t => t.id === taskId ? { ...t, status: 'Rejected', manager_note: note } : t);
      allTasksRef.current = updated; setAllTasks([...updated]);
      toast.error('❌ Rejected!');
    } catch { toast.error('Error!'); }
  };

  // Manager sirf assigned tasks delete kar sakta hai
  const deleteAssignedTask = async (taskId) => {
    if (!window.confirm('Yeh assigned task delete karna chahte hain?')) return;
    try {
      await api.post({ action: 'deleteTask', task_id: taskId });
      const updated = allTasksRef.current.filter(t => t.id !== taskId);
      allTasksRef.current = updated; setAllTasks([...updated]);
      toast.success('🗑️ Task delete ho gaya!');
    } catch { toast.error('Delete nahi hua!'); }
  };

  const addEmployee = async () => {
    if (!newEmp.name.trim()) { toast.error('Naam zaruri hai!'); return; }
    if (!newEmp.password.trim()) { toast.error('Password zaruri hai!'); return; }
    if (employees.some(e => norm(e.name) === norm(newEmp.name))) { toast.error('Yeh naam pehle se hai!'); return; }
    setAddingEmp(true);
    try {
      const data = {
        id: Date.now().toString(), name: newEmp.name.trim(),
        designation: newEmp.designation.trim() || 'Team Member',
        password: newEmp.password.trim(), color: newEmp.color, photo_url: ''
      };
      const res = await api.post({ action: 'addEmployee', data });
      if (res?.status === 'error') { toast.error(res.message || 'Add nahi hua!'); return; }
      setEmployees(prev => [...prev, data]);
      toast.success(`✅ ${newEmp.name} add ho gaya!`);
      setNewEmp({ name: '', designation: '', password: '', color: '#3B82F6' });
      setTimeout(() => loadData(true), 800);
    } catch { toast.error('Add nahi hua! Network check karein.'); }
    finally { setAddingEmp(false); }
  };

  const deleteEmployee = async (id, name) => {
    if (!window.confirm(`"${name}" delete karein?`)) return;
    try {
      await api.post({ action: 'deleteEmployee', employee_id: id });
      setEmployees(prev => prev.filter(e => String(e.id) !== String(id)));
      toast.success(`${name} delete ho gaya!`);
    } catch { toast.error('Delete nahi hua!'); }
  };

  // Assign task — only task_name, date, notes
  const openAssign = (emp) => {
    setAssignTarget(emp);
    setAssignForm({ task_name: '', date: todayStr(), notes: '' });
    setAssignModal(true);
  };

  const submitAssign = async () => {
    if (!assignForm.task_name.trim()) { toast.error('Task naam zaruri!'); return; }
    setAssigning(true);
    try {
      const taskData = {
        id: uuidv4(),
        daily_log_id: `${assignTarget.id}_${assignForm.date}`,
        employee_id: String(assignTarget.id),
        employee_name: String(assignTarget.name),
        date: assignForm.date,
        task_name: assignForm.task_name.trim(),
        start_time: '',
        end_time: '',
        break_time: 0,
        productive_hours: 0,
        status: 'Assigned',
        notes: assignForm.notes || '',
        manager_note: 'Assigned by Manager',
        is_assigned: 'true'
      };
      await api.post({ action: 'saveTask', data: taskData });
      allTasksRef.current = [...allTasksRef.current, { ...taskData, is_assigned: true }];
      setAllTasks([...allTasksRef.current]);
      toast.success(`📌 "${assignForm.task_name}" assign ho gaya!`);
      setAssignModal(false);
    } catch { toast.error('Assign nahi hua!'); }
    finally { setAssigning(false); }
  };

  const changeManagerPassword = async () => {
    if (!managerPass.new1 || !managerPass.new2) { toast.error('Fields fill karein!'); return; }
    if (managerPass.new1 !== managerPass.new2) { toast.error('Match nahi!'); return; }
    setChangingPass(true);
    try {
      await api.post({ action: 'updateManagerPassword', new_password: managerPass.new1 });
      toast.success('Password change ho gaya!');
      setManagerPass({ old: '', new1: '', new2: '' });
    } catch { toast.error('Error!'); }
    finally { setChangingPass(false); }
  };

  const logout = () => { localStorage.removeItem('user'); navigate('/login'); };
  const filteredEmps = employees.filter(e => !searchQuery || norm(e.name).includes(norm(searchQuery)));

  // ── Analytics ─────────────────────────────────────────────────────────────
  const getAnalyticsData = () => {
    let dateRange;
    if (analyticsPeriod === 'daily') dateRange = [analyticsRef];
    else if (analyticsPeriod === 'weekly') { const { start, end } = getWeekRange(analyticsRef); dateRange = getDatesInRange(start, end); }
    else { const { start, end } = getMonthRange(analyticsRef); dateRange = getDatesInRange(start, end); }

    const targetEmps = analyticsEmp === 'all' ? employees : employees.filter(e => e.name === analyticsEmp);

    const empSummary = targetEmps.map(emp => {
      const empLogs = allLogs.filter(l => dateRange.includes(l.date) && empMatch(l, emp));
      const empTasks = allTasks.filter(t => dateRange.includes(t.date) && empMatch(t, emp));
      const totalHrs = empLogs.reduce((s, l) => s + l.total_productive_hours, 0);
      const daysWorked = new Set(empLogs.filter(l => l.submitted).map(l => l.date)).size;
      const avgHrs = daysWorked > 0 ? totalHrs / daysWorked : 0;
      return {
        emp, empLogs, empTasks,
        totalHrs: parseFloat(totalHrs.toFixed(1)), daysWorked,
        avgHrs: parseFloat(avgHrs.toFixed(1)), totalTasks: empTasks.length,
        approved: empTasks.filter(t => t.status === 'Approved').length,
        submitted: empTasks.filter(t => t.status === 'Submitted').length,
        rejected: empTasks.filter(t => t.status === 'Rejected').length,
      };
    });

    const dailyChart = dateRange.map(date => {
      const logsOnDate = allLogs.filter(l => l.date === date && (analyticsEmp === 'all' || targetEmps.some(e => empMatch(l, e))));
      const tasksOnDate = allTasks.filter(t => t.date === date && (analyticsEmp === 'all' || targetEmps.some(e => empMatch(t, e))));
      return {
        label: fmtDate(date), date,
        hrs: parseFloat(logsOnDate.reduce((s, l) => s + l.total_productive_hours, 0).toFixed(1)),
        tasks: tasksOnDate.length,
        approved: tasksOnDate.filter(t => t.status === 'Approved').length,
      };
    }).filter(d => d.hrs > 0 || d.tasks > 0);

    return { empSummary, dailyChart };
  };

  if (loading) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',flexDirection:'column',gap:'16px',background:'#f1f5f9' }}>
      <div style={{ width:'48px',height:'48px',border:'4px solid #e2e8f0',borderTop:'4px solid #4a90d9',borderRadius:'50%',animation:'spin 1s linear infinite' }}/>
      <p style={{ color:'#64748b' }}>Loading...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh',background:'#f1f5f9' }}>

      {/* ── NAV ── */}
      <div style={{ background:'linear-gradient(135deg,#0f172a,#1e3a5f)',position:'sticky',top:0,zIndex:100,boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>
        <div style={{ maxWidth:'1280px',margin:'0 auto',padding:'14px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'10px' }}>
          <div style={{ display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap' }}>
            <span style={{ color:'white',fontWeight:'900',fontSize:'18px' }}>🏢 Manager Panel</span>
            <div style={{ display:'flex',gap:'2px',background:'rgba(255,255,255,0.08)',borderRadius:'10px',padding:'3px' }}>
              {[['dashboard','📊 Dashboard'],['employees','👥 Team'],['analytics','📈 Analytics'],['settings','⚙️ Settings']].map(([t, l]) => (
                <button key={t} onClick={() => setTab(t)} style={{ padding:'7px 14px',borderRadius:'8px',border:'none',cursor:'pointer',background:tab===t?'rgba(255,255,255,0.2)':'transparent',color:tab===t?'white':'#94a3b8',fontWeight:'700',fontSize:'12px' }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap' }}>
            {refreshing && <span style={{ color:'#94a3b8',fontSize:'11px' }}>🔄</span>}
            {lastUpdated && <span style={{ color:'#64748b',fontSize:'11px' }}>Updated: {lastUpdated}</span>}
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              style={{ padding:'7px 10px',borderRadius:'8px',border:'1px solid rgba(255,255,255,0.15)',fontSize:'12px',background:'rgba(255,255,255,0.1)',color:'white',colorScheme:'dark' }}/>
            <button onClick={() => loadData(true)} style={{ padding:'7px 12px',background:'rgba(255,255,255,0.1)',color:'white',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'8px',cursor:'pointer',fontSize:'13px' }}>🔄</button>
            <button onClick={logout} style={{ padding:'7px 14px',background:'rgba(239,68,68,0.2)',color:'#fca5a5',border:'1px solid rgba(239,68,68,0.3)',borderRadius:'8px',cursor:'pointer',fontWeight:'600',fontSize:'12px' }}>Logout</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:'1280px',margin:'0 auto',padding:'24px' }}>

        {/* ══════════════════ DASHBOARD ══════════════════ */}
        {tab === 'dashboard' && (
          <>
            {/* Stats */}
            <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'16px',marginBottom:'24px' }}>
              {[
                ['✅ Submitted', submittedCount, '#10B981', `${employees.length > 0 ? Math.round(submittedCount/employees.length*100) : 0}% complete`],
                ['🔴 Pending', pendingCount, '#EF4444', 'Submit nahi hua'],
                ['⚡ Total Hrs', totalHrs, '#4a90d9', 'Productive'],
                ['📋 Tasks', dayTasks.length, '#8B5CF6', "Today's tasks"],
              ].map(([label, val, color, sub]) => (
                <div key={label} style={{ background:'white',borderRadius:'16px',padding:'20px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)',borderTop:`3px solid ${color}` }}>
                  <p style={{ color:'#94a3b8',fontSize:'12px',fontWeight:'600',marginBottom:'8px' }}>{label}</p>
                  <p style={{ fontSize:'32px',fontWeight:'900',color,marginBottom:'4px' }}>{val}</p>
                  <p style={{ fontSize:'11px',color:'#94a3b8' }}>{sub}</p>
                </div>
              ))}
            </div>

            <div style={{ marginBottom:'16px' }}>
              <input type="text" placeholder="🔍 Search employee..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                style={{ padding:'10px 16px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'14px',outline:'none',width:'280px',background:'white' }}/>
            </div>

            {/* Employee Cards */}
            <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',gap:'16px',marginBottom:'24px' }}>
              {filteredEmps.map(emp => {
                const log = getLog(emp), empTasks = getEmpTasks(emp);
                const isSubmitted = log?.submitted, c = emp.color || '#3B82F6';
                return (
                  <div key={emp.id} style={{ background:'white',borderRadius:'18px',padding:'18px',border:`2px solid ${selectedEmp===emp.name?c:'#e2e8f0'}`,boxShadow:selectedEmp===emp.name?`0 8px 24px ${c}30`:'0 2px 10px rgba(0,0,0,0.06)',transition:'all 0.2s' }}>
                    <div onClick={() => setSelectedEmp(selectedEmp===emp.name?null:emp.name)} style={{ cursor:'pointer' }}>
                      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px' }}>
                        <div style={{ width:'50px',height:'50px',borderRadius:'50%',background:c,display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'900',fontSize:'20px',overflow:'hidden' }}>
                          {emp.photo_url ? <img src={emp.photo_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/> : emp.name?.[0]}
                        </div>
                        <span style={{ padding:'4px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',background:isSubmitted?'#D1FAE5':'#FEE2E2',color:isSubmitted?'#065F46':'#991B1B' }}>
                          {isSubmitted ? '✅ Done' : '🔴 Pending'}
                        </span>
                      </div>
                      <h3 style={{ fontWeight:'800',fontSize:'15px',color:'#0f172a',marginBottom:'2px' }}>{emp.name}</h3>
                      <p style={{ color:'#94a3b8',fontSize:'12px',marginBottom:'10px' }}>{emp.designation}</p>
                      {log ? (
                        <div style={{ fontSize:'12px',color:'#64748b' }}>
                          <div style={{ display:'flex',justifyContent:'space-between',marginBottom:'4px' }}>
                            <span>🕐 In: <b>{log.office_in || '--'}</b></span>
                            <span>Out: <b>{log.office_out || '--'}</b></span>
                          </div>
                          <div style={{ display:'flex',justifyContent:'space-between' }}>
                            <span style={{ fontWeight:'700',color:c }}>⚡ {log.total_productive_hours} hrs</span>
                            <span>📋 {empTasks.length}</span>
                          </div>
                        </div>
                      ) : <p style={{ fontSize:'12px',color:'#cbd5e1',fontStyle:'italic' }}>No data</p>}
                    </div>
                    <button onClick={e => { e.stopPropagation(); openAssign(emp); }}
                      style={{ width:'100%',marginTop:'12px',padding:'7px',background:'linear-gradient(135deg,#7C3AED,#8B5CF6)',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'12px' }}>
                      📌 Task Assign
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Selected employee tasks panel */}
            {selectedEmp && (() => {
              const emp = employees.find(e => e.name === selectedEmp);
              const empTasks = emp ? getEmpTasks(emp) : [];
              return (
                <div style={{ background:'white',borderRadius:'18px',padding:'24px',marginBottom:'24px',boxShadow:'0 2px 12px rgba(0,0,0,0.08)' }}>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px' }}>
                    <h3 style={{ fontSize:'18px',fontWeight:'800',color:'#0f172a' }}>📋 {selectedEmp} — {selectedDate}</h3>
                    <div style={{ display:'flex',gap:'8px' }}>
                      {emp && <button onClick={() => openAssign(emp)} style={{ padding:'8px 16px',background:'linear-gradient(135deg,#7C3AED,#8B5CF6)',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'13px' }}>📌 Assign</button>}
                      <button onClick={() => setSelectedEmp(null)} style={{ padding:'6px 14px',background:'#f1f5f9',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'600',color:'#64748b',fontSize:'13px' }}>✕</button>
                    </div>
                  </div>
                  {empTasks.length === 0 ? (
                    <div style={{ textAlign:'center',padding:'40px',color:'#94a3b8' }}><div style={{ fontSize:'40px',marginBottom:'10px' }}>📭</div><p>Koi tasks nahi</p></div>
                  ) : empTasks.map(task => (
                    <div key={task.id} style={{ border:`2px solid ${sColor(task.status)}20`,borderLeft:`4px solid ${sColor(task.status)}`,borderRadius:'12px',padding:'16px',marginBottom:'12px',background:task.is_assigned?'#FAFAFF':'#fafafa' }}>
                      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px',flexWrap:'wrap',gap:'6px' }}>
                        <div>
                          <h4 style={{ fontWeight:'700',fontSize:'15px',color:'#0f172a' }}>{task.task_name}</h4>
                          {task.is_assigned && <span style={{ fontSize:'10px',background:'#EDE9FE',color:'#5B21B6',padding:'2px 8px',borderRadius:'8px',fontWeight:'700' }}>📌 Assigned</span>}
                        </div>
                        <div style={{ display:'flex',gap:'8px',alignItems:'center' }}>
                          <span style={{ padding:'4px 12px',borderRadius:'20px',fontSize:'12px',fontWeight:'700',background:sColor(task.status)+'20',color:sColor(task.status) }}>{task.status}</span>
                          {task.is_assigned && (
                            <button onClick={() => deleteAssignedTask(task.id)} style={{ padding:'4px 10px',background:'#FEE2E2',color:'#DC2626',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'12px' }}>🗑 Delete</button>
                          )}
                        </div>
                      </div>
                      <div style={{ display:'flex',gap:'16px',fontSize:'13px',color:'#64748b',marginBottom:'8px',flexWrap:'wrap' }}>
                        {task.start_time && <span>🕐 {task.start_time} → {task.end_time}</span>}
                        {task.break_time > 0 && <span>☕ {task.break_time}m</span>}
                        {task.productive_hours > 0 && <span style={{ color:'#10B981',fontWeight:'700' }}>⚡ {task.productive_hours}h</span>}
                      </div>
                      {task.notes && <div style={{ fontSize:'13px',color:'#475569',background:'white',padding:'8px 12px',borderRadius:'8px',marginBottom:'8px',border:'1px solid #e2e8f0' }}>📝 {task.notes}</div>}
                      {task.manager_note && task.manager_note !== 'Assigned by Manager' && (
                        <div style={{ fontSize:'13px',color:'#EF4444',background:'#FEF2F2',padding:'8px 12px',borderRadius:'8px',marginBottom:'8px',border:'1px solid #FECACA' }}>💬 {task.manager_note}</div>
                      )}
                      {norm(task.status) === 'submitted' && (
                        <div style={{ display:'flex',gap:'8px',marginTop:'10px' }}>
                          <button onClick={() => approveTask(task.id)} style={{ padding:'8px 20px',background:'linear-gradient(135deg,#059669,#10B981)',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'13px' }}>✅ Approve</button>
                          <button onClick={() => rejectTask(task.id)} style={{ padding:'8px 20px',background:'linear-gradient(135deg,#DC2626,#EF4444)',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'13px' }}>❌ Reject</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Summary table */}
            <div style={{ background:'white',borderRadius:'18px',padding:'24px',marginBottom:'24px',overflowX:'auto',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontWeight:'800',marginBottom:'16px',color:'#0f172a',fontSize:'16px' }}>📊 Summary — {selectedDate}</h3>
              <table style={{ width:'100%',borderCollapse:'collapse',minWidth:'600px' }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['Employee','Designation','In','Out','Tasks','Hrs','Status'].map(h => (
                      <th key={h} style={{ padding:'12px 16px',textAlign:'left',fontWeight:'700',fontSize:'12px',color:'#64748b',borderBottom:'2px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, i) => {
                    const log = getLog(emp), empTasks = getEmpTasks(emp);
                    return (
                      <tr key={emp.id} onClick={() => setSelectedEmp(selectedEmp===emp.name?null:emp.name)}
                        style={{ borderBottom:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa',cursor:'pointer' }}>
                        <td style={{ padding:'14px 16px',fontWeight:'700',fontSize:'14px' }}>
                          <div style={{ display:'flex',alignItems:'center',gap:'8px' }}>
                            <div style={{ width:'28px',height:'28px',borderRadius:'50%',background:emp.color||'#3B82F6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:'12px',fontWeight:'800' }}>{emp.name?.[0]}</div>
                            {emp.name}
                          </div>
                        </td>
                        <td style={{ padding:'14px 16px',color:'#64748b',fontSize:'13px' }}>{emp.designation}</td>
                        <td style={{ padding:'14px 16px',fontSize:'13px',fontWeight:'600',color:log?.office_in?'#1e293b':'#cbd5e1' }}>{log?.office_in || '--'}</td>
                        <td style={{ padding:'14px 16px',fontSize:'13px',fontWeight:'600',color:log?.office_out?'#1e293b':'#cbd5e1' }}>{log?.office_out || '--'}</td>
                        <td style={{ padding:'14px 16px',fontSize:'13px',fontWeight:'600' }}>{empTasks.length}</td>
                        <td style={{ padding:'14px 16px',fontWeight:'800',color:'#10B981',fontSize:'14px' }}>{log?.total_productive_hours || 0} hrs</td>
                        <td style={{ padding:'14px 16px' }}>
                          <span style={{ padding:'4px 12px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',background:log?.submitted?'#D1FAE5':'#FEE2E2',color:log?.submitted?'#065F46':'#991B1B' }}>
                            {log?.submitted ? '✅ Submitted' : '🔴 Pending'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bar chart */}
            <div style={{ background:'white',borderRadius:'18px',padding:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontWeight:'800',marginBottom:'20px',color:'#0f172a',fontSize:'16px' }}>📈 Hours — {selectedDate}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={employees.map(e => ({ name: e.name?.split(' ')[0], hours: getLog(e)?.total_productive_hours || 0, color: e.color || '#3B82F6' }))} barSize={40}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize:'13px',fontWeight:'700' }}/>
                  <YAxis axisLine={false} tickLine={false} style={{ fontSize:'12px' }}/>
                  <Tooltip formatter={v => [`${v} hrs`, 'Productive']} contentStyle={{ borderRadius:'10px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)' }}/>
                  <Bar dataKey="hours" radius={[8,8,0,0]}>
                    {employees.map((e, i) => <Cell key={i} fill={e.color || '#3B82F6'}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* ══════════════════ TEAM ══════════════════ */}
        {tab === 'employees' && (
          <>
            <div style={{ background:'white',borderRadius:'18px',padding:'24px',marginBottom:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontWeight:'800',marginBottom:'20px',color:'#0f172a',fontSize:'17px' }}>➕ New Employee</h3>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr 80px',gap:'12px',alignItems:'end',marginBottom:'16px' }}>
                {[['👤 Name *','name','text','Ali Khan'],['🎯 Designation','designation','text','Designer'],['🔑 Password *','password','password','••••••']].map(([label, field, type, ph]) => (
                  <div key={field}>
                    <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>{label}</label>
                    <input type={type} placeholder={ph} value={newEmp[field]}
                      onChange={e => setNewEmp(p => ({ ...p, [field]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addEmployee()}
                      style={{ width:'100%',padding:'10px 12px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'13px',outline:'none',boxSizing:'border-box' }}/>
                  </div>
                ))}
                <div>
                  <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>🎨</label>
                  <input type="color" value={newEmp.color} onChange={e => setNewEmp(p => ({ ...p, color: e.target.value }))}
                    style={{ width:'100%',height:'42px',borderRadius:'10px',border:'2px solid #e2e8f0',cursor:'pointer',padding:'2px' }}/>
                </div>
              </div>
              <button onClick={addEmployee} disabled={addingEmp}
                style={{ padding:'11px 28px',background:addingEmp?'#94a3b8':'linear-gradient(135deg,#1e3a5f,#4a90d9)',color:'white',border:'none',borderRadius:'10px',fontWeight:'700',fontSize:'14px',cursor:addingEmp?'not-allowed':'pointer',boxShadow:'0 4px 12px rgba(74,144,217,0.3)' }}>
                {addingEmp ? '⏳ Adding...' : '✅ Add Karein'}
              </button>
            </div>

            <div style={{ background:'white',borderRadius:'18px',padding:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px' }}>
                <h3 style={{ fontWeight:'800',color:'#0f172a',fontSize:'17px' }}>👥 Team ({employees.length})</h3>
                <input type="text" placeholder="🔍 Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  style={{ padding:'8px 14px',borderRadius:'8px',border:'2px solid #e2e8f0',fontSize:'13px',outline:'none',width:'200px' }}/>
              </div>
              {filteredEmps.map(emp => (
                <div key={emp.id} style={{ display:'flex',alignItems:'center',gap:'16px',padding:'16px',borderRadius:'12px',marginBottom:'10px',border:'2px solid #f1f5f9',background:'#fafafa' }}>
                  <div style={{ width:'48px',height:'48px',borderRadius:'50%',background:emp.color||'#3B82F6',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'800',fontSize:'18px',overflow:'hidden' }}>
                    {emp.photo_url ? <img src={emp.photo_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/> : emp.name?.[0]}
                  </div>
                  <div style={{ flex:1 }}>
                    <p style={{ fontWeight:'800',fontSize:'15px',color:'#0f172a' }}>{emp.name}</p>
                    <p style={{ color:'#64748b',fontSize:'12px' }}>{emp.designation || 'Team Member'}</p>
                  </div>
                  <div style={{ display:'flex',gap:'8px' }}>
                    <button onClick={() => openAssign(emp)} style={{ padding:'7px 14px',background:'linear-gradient(135deg,#7C3AED,#8B5CF6)',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'12px' }}>📌 Assign</button>
                    <button onClick={() => deleteEmployee(emp.id, emp.name)} style={{ padding:'7px 14px',background:'#FEE2E2',color:'#DC2626',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'12px' }}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ══════════════════ ANALYTICS ══════════════════ */}
        {tab === 'analytics' && (() => {
          const { empSummary, dailyChart } = getAnalyticsData();
          const periodLabel = analyticsPeriod === 'daily' ? fmtDate(analyticsRef)
            : analyticsPeriod === 'weekly' ? `Week of ${fmtDate(getWeekRange(analyticsRef).start)}`
            : fmtMonth(analyticsRef);
          return (
            <>
              {/* Controls */}
              <div style={{ background:'white',borderRadius:'16px',padding:'20px',marginBottom:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)',display:'flex',gap:'16px',alignItems:'flex-end',flexWrap:'wrap' }}>
                <div>
                  <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>📅 Period</label>
                  <div style={{ display:'flex',gap:'4px',background:'#f1f5f9',borderRadius:'10px',padding:'3px' }}>
                    {[['daily','📅 Daily'],['weekly','📆 Weekly'],['monthly','🗓 Monthly']].map(([p, l]) => (
                      <button key={p} onClick={() => setAnalyticsPeriod(p)} style={{ padding:'7px 14px',borderRadius:'8px',border:'none',cursor:'pointer',background:analyticsPeriod===p?'linear-gradient(135deg,#1e3a5f,#4a90d9)':'transparent',color:analyticsPeriod===p?'white':'#64748b',fontWeight:'700',fontSize:'12px' }}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>
                    {analyticsPeriod === 'daily' ? '📅 Date' : analyticsPeriod === 'weekly' ? '📅 Week (any day)' : '📅 Month (any day)'}
                  </label>
                  <input type="date" value={analyticsRef} onChange={e => setAnalyticsRef(e.target.value)}
                    style={{ padding:'9px 12px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'13px',outline:'none' }}/>
                </div>
                <div>
                  <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>👤 Employee</label>
                  <select value={analyticsEmp} onChange={e => setAnalyticsEmp(e.target.value)}
                    style={{ padding:'9px 12px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'13px',outline:'none',background:'white',minWidth:'160px' }}>
                    <option value="all">All Employees</option>
                    {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div style={{ marginLeft:'auto',padding:'10px 18px',background:'#f0f9ff',borderRadius:'10px',border:'1px solid #bae6fd' }}>
                  <p style={{ fontSize:'11px',color:'#0369a1',fontWeight:'600' }}>Period</p>
                  <p style={{ fontSize:'14px',color:'#0c4a6e',fontWeight:'800' }}>{periodLabel}</p>
                </div>
              </div>

              {/* Employee summary cards */}
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'16px',marginBottom:'24px' }}>
                {empSummary.map(({ emp, totalHrs, daysWorked, approved, submitted, rejected, totalTasks, avgHrs }) => (
                  <div key={emp.id} style={{ background:'white',borderRadius:'18px',padding:'20px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)',borderTop:`4px solid ${emp.color||'#3B82F6'}` }}>
                    <div style={{ display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px' }}>
                      <div style={{ width:'44px',height:'44px',borderRadius:'50%',background:emp.color||'#3B82F6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'800',fontSize:'18px',flexShrink:0,overflow:'hidden' }}>
                        {emp.photo_url ? <img src={emp.photo_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/> : emp.name?.[0]}
                      </div>
                      <div>
                        <p style={{ fontWeight:'800',fontSize:'15px',color:'#0f172a' }}>{emp.name}</p>
                        <p style={{ fontSize:'11px',color:'#94a3b8' }}>{emp.designation}</p>
                      </div>
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'14px' }}>
                      {[['⚡ Total Hrs',`${totalHrs} hrs`,emp.color||'#3B82F6'],['📅 Days',daysWorked,'#4a90d9'],['📊 Avg/Day',`${avgHrs} hrs`,'#8B5CF6'],['📋 Tasks',totalTasks,'#6B7280']].map(([l, v, c]) => (
                        <div key={l} style={{ background:'#f8fafc',borderRadius:'10px',padding:'10px',textAlign:'center' }}>
                          <p style={{ fontSize:'10px',color:'#94a3b8',fontWeight:'600',marginBottom:'4px' }}>{l}</p>
                          <p style={{ fontSize:'18px',fontWeight:'900',color:c }}>{v}</p>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'12px' }}>
                      {[['✅',approved,'#10B981','#D1FAE5'],['⏳',submitted,'#F59E0B','#FEF3C7'],['❌',rejected,'#EF4444','#FEE2E2']].map(([icon, count, color, bg]) => (
                        <span key={icon} style={{ padding:'3px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',background:bg,color }}>{icon} {count}</span>
                      ))}
                    </div>
                    <div>
                      <div style={{ display:'flex',justifyContent:'space-between',marginBottom:'4px' }}>
                        <span style={{ fontSize:'10px',color:'#94a3b8',fontWeight:'600' }}>Avg vs 8h target</span>
                        <span style={{ fontSize:'10px',color:emp.color||'#3B82F6',fontWeight:'700' }}>{Math.min(100, avgHrs/8*100).toFixed(0)}%</span>
                      </div>
                      <div style={{ height:'6px',background:'#f1f5f9',borderRadius:'3px',overflow:'hidden' }}>
                        <div style={{ height:'100%',width:`${Math.min(100,avgHrs/8*100)}%`,background:emp.color||'#3B82F6',borderRadius:'3px',transition:'width 0.5s ease' }}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Trend chart */}
              {dailyChart.length > 0 && (
                <div style={{ background:'white',borderRadius:'18px',padding:'24px',marginBottom:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ fontWeight:'800',marginBottom:'20px',color:'#0f172a',fontSize:'16px' }}>📈 Daily Trend — {periodLabel}</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={dailyChart}>
                      <XAxis dataKey="label" axisLine={false} tickLine={false} style={{ fontSize:'11px' }}/>
                      <YAxis axisLine={false} tickLine={false} style={{ fontSize:'11px' }}/>
                      <Tooltip contentStyle={{ borderRadius:'10px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)' }}/>
                      <Legend/>
                      <Line type="monotone" dataKey="hrs" name="Hours" stroke="#4a90d9" strokeWidth={2.5} dot={{ r:4,fill:'#4a90d9' }}/>
                      <Line type="monotone" dataKey="tasks" name="Tasks" stroke="#8B5CF6" strokeWidth={2} dot={{ r:3,fill:'#8B5CF6' }} strokeDasharray="4 2"/>
                      <Line type="monotone" dataKey="approved" name="Approved" stroke="#10B981" strokeWidth={2} dot={{ r:3,fill:'#10B981' }} strokeDasharray="6 3"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Detail tables */}
              {empSummary.map(({ emp, empLogs, empTasks }) => {
                if (empLogs.length === 0 && empTasks.length === 0) return null;
                return (
                  <div key={emp.id} style={{ background:'white',borderRadius:'18px',padding:'20px',marginBottom:'20px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:'10px',marginBottom:'16px' }}>
                      <div style={{ width:'32px',height:'32px',borderRadius:'50%',background:emp.color||'#3B82F6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'800',fontSize:'14px' }}>{emp.name?.[0]}</div>
                      <h4 style={{ fontWeight:'800',color:'#0f172a',fontSize:'15px' }}>{emp.name} — Detail</h4>
                    </div>
                    <div style={{ overflowX:'auto' }}>
                      <table style={{ width:'100%',borderCollapse:'collapse',minWidth:'500px' }}>
                        <thead>
                          <tr style={{ background:'#f8fafc' }}>
                            {['Date','In','Out','Office Hrs','Productive Hrs','Tasks','Status'].map(h => (
                              <th key={h} style={{ padding:'10px 12px',textAlign:'left',fontWeight:'700',fontSize:'11px',color:'#64748b',borderBottom:'2px solid #e2e8f0',whiteSpace:'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...empLogs].sort((a, b) => a.date.localeCompare(b.date)).map((log, i) => {
                            const dayTaskCount = empTasks.filter(t => t.date === log.date).length;
                            const offHrs = (() => {
                              if (!log.office_in || !log.office_out) return '--';
                              let s = new Date('2000/01/01 ' + log.office_in), e = new Date('2000/01/01 ' + log.office_out);
                              if (e <= s) e = new Date('2000/01/02 ' + log.office_out);
                              return Math.max(0, (e - s) / 3600000).toFixed(1) + ' h';
                            })();
                            return (
                              <tr key={i} style={{ borderBottom:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa' }}>
                                <td style={{ padding:'12px',fontWeight:'700',fontSize:'13px',color:'#1e293b',whiteSpace:'nowrap' }}>{fmtDate(log.date)}</td>
                                <td style={{ padding:'12px',fontSize:'13px',color:'#475569' }}>{log.office_in || '--'}</td>
                                <td style={{ padding:'12px',fontSize:'13px',color:'#475569' }}>{log.office_out || '--'}</td>
                                <td style={{ padding:'12px',fontSize:'13px',color:'#4a90d9',fontWeight:'600' }}>{offHrs}</td>
                                <td style={{ padding:'12px',fontSize:'14px',fontWeight:'800',color:'#10B981' }}>{log.total_productive_hours} hrs</td>
                                <td style={{ padding:'12px',fontSize:'13px',fontWeight:'600' }}>{dayTaskCount}</td>
                                <td style={{ padding:'12px' }}>
                                  <span style={{ padding:'3px 10px',borderRadius:'10px',fontSize:'11px',fontWeight:'700',background:log.submitted?'#D1FAE5':'#FEE2E2',color:log.submitted?'#065F46':'#991B1B' }}>
                                    {log.submitted ? '✅' : '🔴'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background:'#0f172a' }}>
                            <td colSpan={4} style={{ padding:'12px',color:'#94a3b8',fontWeight:'700',fontSize:'12px' }}>TOTAL</td>
                            <td style={{ padding:'12px',color:'#4ade80',fontWeight:'900',fontSize:'15px' }}>{empLogs.reduce((s, l) => s + l.total_productive_hours, 0).toFixed(1)} hrs</td>
                            <td style={{ padding:'12px',color:'#94a3b8',fontWeight:'700' }}>{empTasks.length}</td>
                            <td style={{ padding:'12px',color:'#4ade80',fontWeight:'700',fontSize:'12px' }}>{new Set(empLogs.filter(l => l.submitted).map(l => l.date)).size} days</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })}

              {empSummary.every(s => s.empLogs.length === 0 && s.empTasks.length === 0) && (
                <div style={{ background:'white',borderRadius:'18px',padding:'60px',textAlign:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize:'48px',marginBottom:'12px' }}>📭</div>
                  <p style={{ color:'#94a3b8',fontSize:'16px' }}>Is period mein koi data nahi</p>
                </div>
              )}
            </>
          );
        })()}

        {/* ══════════════════ SETTINGS ══════════════════ */}
        {tab === 'settings' && (
          <>
            <div style={{ background:'white',borderRadius:'18px',padding:'24px',marginBottom:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontWeight:'800',marginBottom:'20px',color:'#0f172a',fontSize:'17px' }}>🔑 Password Change</h3>
              <div style={{ maxWidth:'400px' }}>
                {[['New Password','new1'],['Confirm Password','new2']].map(([label, field]) => (
                  <div key={field} style={{ marginBottom:'14px' }}>
                    <label style={{ fontSize:'13px',fontWeight:'600',color:'#475569',display:'block',marginBottom:'6px' }}>{label}</label>
                    <input type="password" value={managerPass[field]} onChange={e => setManagerPass(p => ({ ...p, [field]: e.target.value }))}
                      style={{ width:'100%',padding:'11px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'14px',outline:'none' }}/>
                  </div>
                ))}
                <button onClick={changeManagerPassword} disabled={changingPass}
                  style={{ padding:'11px 24px',background:changingPass?'#94a3b8':'linear-gradient(135deg,#1e3a5f,#4a90d9)',color:'white',border:'none',borderRadius:'10px',fontWeight:'700',fontSize:'14px',cursor:changingPass?'not-allowed':'pointer' }}>
                  {changingPass ? '⏳...' : '🔐 Change'}
                </button>
              </div>
            </div>
            <div style={{ background:'white',borderRadius:'18px',padding:'24px',boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontWeight:'800',marginBottom:'16px',color:'#0f172a',fontSize:'17px' }}>ℹ️ System Info</h3>
              {[['System','Skagen Attendance Tracker'],['Version','3.0.0'],['Employees',employees.length],['Auto-refresh','60s']].map(([l, v]) => (
                <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid #f1f5f9' }}>
                  <span style={{ fontSize:'13px',color:'#64748b',fontWeight:'600' }}>{l}</span>
                  <span style={{ fontSize:'13px',color:'#1e293b',fontWeight:'700' }}>{v}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ══════════════════ ASSIGN MODAL — no time fields ══════════════════ */}
      {assignModal && assignTarget && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px' }}
          onClick={e => { if (e.target === e.currentTarget) setAssignModal(false); }}>
          <div style={{ background:'white',borderRadius:'20px',padding:'28px',width:'100%',maxWidth:'440px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>

            {/* Header */}
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'22px' }}>
              <div>
                <h3 style={{ fontWeight:'800',fontSize:'18px',color:'#0f172a' }}>📌 Task Assign</h3>
                <div style={{ display:'flex',alignItems:'center',gap:'8px',marginTop:'6px' }}>
                  <div style={{ width:'26px',height:'26px',borderRadius:'50%',background:assignTarget.color||'#3B82F6',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'800',fontSize:'12px' }}>
                    {assignTarget.name?.[0]}
                  </div>
                  <span style={{ fontWeight:'700',color:'#475569',fontSize:'14px' }}>{assignTarget.name}</span>
                  <span style={{ fontSize:'12px',color:'#94a3b8' }}>• {assignTarget.designation}</span>
                </div>
              </div>
              <button onClick={() => setAssignModal(false)}
                style={{ background:'#f1f5f9',border:'none',borderRadius:'8px',padding:'8px 12px',cursor:'pointer',fontWeight:'700',color:'#64748b',fontSize:'16px' }}>✕</button>
            </div>

            {/* Task name */}
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>✅ Task Name *</label>
              <input type="text" placeholder="Task naam..." value={assignForm.task_name}
                onChange={e => setAssignForm(p => ({ ...p, task_name: e.target.value }))}
                style={{ width:'100%',padding:'11px 14px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'14px',outline:'none',boxSizing:'border-box',fontWeight:'600' }}/>
            </div>

            {/* Date */}
            <div style={{ marginBottom:'14px' }}>
              <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>📅 Date *</label>
              <input type="date" value={assignForm.date}
                onChange={e => setAssignForm(p => ({ ...p, date: e.target.value }))}
                style={{ width:'100%',padding:'11px 14px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'14px',outline:'none',boxSizing:'border-box' }}/>
            </div>

            {/* Notes only — NO start/end/break */}
            <div style={{ marginBottom:'22px' }}>
              <label style={{ fontSize:'12px',fontWeight:'700',color:'#475569',display:'block',marginBottom:'6px' }}>📝 Notes / Instructions</label>
              <textarea placeholder="Task ki details ya instructions..." value={assignForm.notes}
                onChange={e => setAssignForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                style={{ width:'100%',padding:'10px 14px',borderRadius:'10px',border:'2px solid #e2e8f0',fontSize:'13px',outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box',color:'#475569' }}/>
            </div>

            {/* Buttons */}
            <div style={{ display:'flex',gap:'10px' }}>
              <button onClick={() => setAssignModal(false)}
                style={{ flex:1,padding:'12px',background:'#f1f5f9',border:'none',borderRadius:'10px',cursor:'pointer',fontWeight:'700',color:'#64748b',fontSize:'14px' }}>
                Cancel
              </button>
              <button onClick={submitAssign} disabled={assigning}
                style={{ flex:2,padding:'12px',background:assigning?'#94a3b8':'linear-gradient(135deg,#7C3AED,#8B5CF6)',color:'white',border:'none',borderRadius:'10px',cursor:assigning?'not-allowed':'pointer',fontWeight:'800',fontSize:'14px',boxShadow:assigning?'none':'0 4px 14px rgba(139,92,246,0.4)' }}>
                {assigning ? '⏳ Assigning...' : '📌 Assign Karein'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
