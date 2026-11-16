import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';

// ─── Voice → text dictation ───────────────────────────────────────────────────
// Uses the browser's built-in speech recognition (Chrome / Edge / Android Chrome),
// so no API key or cost. Only the recognized text is kept — no audio is saved.
// props:
//   onText(text)  called with each finished phrase
//   disabled

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

const LANGS = [['en-US', 'EN'], ['ur-PK', 'اردو']];
const LANG_KEY = 'dictation_lang';
const readLang = () => { try { return localStorage.getItem(LANG_KEY) || 'en-US'; } catch { return 'en-US'; } };

export default function VoiceDictation({ onText, disabled }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim]     = useState('');
  const [lang, setLang]           = useState(readLang);
  const recRef = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => { if (recRef.current) recRef.current.abort(); }, []);

  if (!SpeechRecognition) return null; // unsupported browser (e.g. Firefox) — typing still works

  const changeLang = (l) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch {}
  };

  const start = () => {
    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) { if (text.trim()) onTextRef.current(text.trim()); }
        else live += text;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Mic ki permission nahi mili — browser settings mein allow karein.');
      else if (e.error === 'network') toast.error('Voice ke liye internet zaruri hai.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast.error('Voice samajh nahi aayi, dobara try karein.');
    };
    rec.onend = () => { setListening(false); setInterim(''); recRef.current = null; };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  const stop = () => { if (recRef.current) recRef.current.stop(); };

  return (
    <div style={{ marginTop:'6px' }}>
      <div style={{ display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap' }}>
        <button type="button" onClick={listening ? stop : start} disabled={disabled}
          style={{ padding:'5px 12px',borderRadius:'8px',border:'none',cursor:disabled?'not-allowed':'pointer',fontWeight:'700',fontSize:'11px',
            background:listening?'linear-gradient(135deg,#DC2626,#EF4444)':'#EFF6FF',color:listening?'white':'#3B37A6',opacity:disabled?0.5:1 }}>
          {listening ? '⏹ Stop' : '🎤 Bol kar likhein'}
        </button>
        <div style={{ display:'flex',gap:'2px',background:'#f1f5f9',borderRadius:'8px',padding:'2px' }}>
          {LANGS.map(([code, label]) => (
            <button key={code} type="button" onClick={() => changeLang(code)} disabled={listening || disabled}
              style={{ padding:'3px 8px',borderRadius:'6px',border:'none',cursor:listening||disabled?'not-allowed':'pointer',fontSize:'10px',fontWeight:'700',
                background:lang===code?'white':'transparent',color:lang===code?'#1e293b':'#94a3b8' }}>{label}</button>
          ))}
        </div>
        {listening && <span style={{ fontSize:'10px',color:'#DC2626',fontWeight:'700' }}>● Sun raha hai...</span>}
      </div>
      {interim && <p style={{ fontSize:'11px',color:'#94a3b8',fontStyle:'italic',marginTop:'4px' }}>{interim}</p>}
    </div>
  );
}
