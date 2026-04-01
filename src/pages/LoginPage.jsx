import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';

export default function LoginPage() {
  const [role, setRole] = useState('');
  const [employees, setEmployees] = useState([]);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const navigate = useNavigate();

  const loadEmployees = useCallback(async () => {
    try {
      const data = await api.get({ action: 'getEmployees' });
      if (Array.isArray(data) && data.length > 0) setEmployees(data);
    } catch (err) {
      console.log(err);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.role === 'employee') {
      navigate('/employee', { replace: true });
    } else if (user?.role === 'manager') {
      navigate('/manager', { replace: true });
    }
    loadEmployees();
  }, [navigate, loadEmployees]);

  const handleLogin = async () => {
    if (!role) { toast.error("Role select karein!"); return; }
    if (!password) { toast.error("Password daalen!"); return; }
    setLoading(true);
    try {
      if (role === 'manager') {
        const config = await api.get({ action: 'getManagerConfig' });
        const managerPass = Array.isArray(config)
          ? config.find(c => c.key === 'manager_password')?.value
          : 'manager2024';
        if (password === (managerPass || 'manager2024')) {
          localStorage.setItem('user', JSON.stringify({ role: 'manager' }));
          toast.success("Welcome Manager! 👑");
          navigate('/manager', { replace: true });
        } else {
          toast.error("Manager password galat hai!");
        }
        setLoading(false);
        return;
      }
      if (!name) { toast.error("Naam select karein!"); setLoading(false); return; }
      const match = employees.find(e =>
        String(e.name).trim().toLowerCase() === name.trim().toLowerCase() &&
        String(e.password).trim() === String(password).trim()
      );
      if (match) {
        localStorage.setItem('user', JSON.stringify({
          role: 'employee',
          id: String(match.id),
          name: match.name,
          designation: match.designation || 'Team Member',
          color: match.color || '#3B82F6',
          photo: match.photo_url || ''
        }));
        toast.success(`Welcome ${match.name}! 👋`);
        navigate('/employee', { replace: true });
      } else {
        toast.error("Naam ya password galat hai!");
      }
    } catch (err) {
      toast.error("Connection error! Dobara try karein.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #4a90d9 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }}>
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: `${80 + i * 60}px`, height: `${80 + i * 60}px`,
            borderRadius: '50%', border: '1px solid rgba(255,255,255,0.05)',
            top: `${10 + i * 15}%`, left: `${5 + i * 15}%`
          }} />
        ))}
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.97)', borderRadius: '24px', padding: '44px 40px',
        width: '100%', maxWidth: '420px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)',
        position: 'relative', zIndex: 1
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '20px',
            background: 'linear-gradient(135deg, #1e3a5f, #4a90d9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', fontSize: '34px',
            boxShadow: '0 8px 24px rgba(74,144,217,0.4)'
          }}>🏢</div>
          <h1 style={{ fontSize: '26px', fontWeight: '900', color: '#1e3a5f', letterSpacing: '-0.5px' }}>
            Skagen Tracker
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
            Attendance & Task Management System
          </p>
        </div>

        <div style={{
          display: 'flex', background: '#f1f5f9', borderRadius: '12px',
          padding: '4px', marginBottom: '24px', gap: '4px'
        }}>
          {[['employee', '👤 Employee'], ['manager', '👑 Manager']].map(([r, label]) => (
            <button key={r} onClick={() => { setRole(r); setName(''); setPassword(''); }} style={{
              flex: 1, padding: '10px', borderRadius: '9px', border: 'none',
              background: role === r ? 'white' : 'transparent',
              color: role === r ? '#1e3a5f' : '#94a3b8',
              fontWeight: '700', fontSize: '13px', cursor: 'pointer',
              boxShadow: role === r ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s'
            }}>{label}</button>
          ))}
        </div>

        {role === 'employee' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '8px', fontSize: '13px', color: '#475569' }}>
              Apna Naam
            </label>
            {fetching ? (
              <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', color: '#94a3b8', fontSize: '13px', border: '2px solid #e2e8f0' }}>
                ⏳ Loading employees...
              </div>
            ) : (
              <select value={name} onChange={e => setName(e.target.value)} style={{
                width: '100%', padding: '12px 14px', borderRadius: '10px',
                border: '2px solid #e2e8f0', fontSize: '14px', outline: 'none',
                background: 'white', color: name ? '#1e293b' : '#94a3b8',
                transition: 'border-color 0.2s'
              }}
                onFocus={e => e.target.style.borderColor = '#4a90d9'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              >
                <option value="">-- Select karein --</option>
                {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
              </select>
            )}
          </div>
        )}

        {role && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontWeight: '600', display: 'block', marginBottom: '8px', fontSize: '13px', color: '#475569' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  style={{
                    width: '100%', padding: '12px 44px 12px 14px', borderRadius: '10px',
                    border: '2px solid #e2e8f0', fontSize: '14px', outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={e => e.target.style.borderColor = '#4a90d9'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
                <button onClick={() => setShowPass(!showPass)} style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#94a3b8'
                }}>{showPass ? '🙈' : '👁️'}</button>
              </div>
            </div>
            <button onClick={handleLogin} disabled={loading} style={{
              width: '100%', padding: '14px',
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #1e3a5f, #4a90d9)',
              color: 'white', borderRadius: '12px', border: 'none',
              fontWeight: '800', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(74,144,217,0.4)',
              transition: 'all 0.2s'
            }}>
              {loading ? '⏳ Logging in...' : '🔐 Login'}
            </button>
          </>
        )}

        <p style={{ textAlign: 'center', color: '#cbd5e1', fontSize: '11px', marginTop: '20px' }}>
          Skagen Digital Agency © 2026
        </p>
      </div>
    </div>
  );
}
