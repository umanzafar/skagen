import { supabase, PHOTO_BUCKET, CHAT_BUCKET } from './lib/supabaseClient';

// ─── employees ──────────────────────────────────────────────────────────────
export async function getEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('getEmployees:', error); return []; }
  return data || [];
}

export async function addEmployee(data) {
  const { error } = await supabase.from('employees').insert(data);
  if (error) { console.error('addEmployee:', error); return { status: 'error', message: error.message }; }
  return { status: 'ok' };
}

export async function deleteEmployee(employeeId) {
  const { error } = await supabase.from('employees').delete().eq('id', String(employeeId));
  if (error) { console.error('deleteEmployee:', error); return { status: 'error', message: error.message }; }
  return { status: 'ok' };
}

// Uploads a File to Supabase Storage and updates the employee's photo_url
export async function uploadPhoto(employeeId, file) {
  if (file.size > 1024 * 1024) throw new Error('Photo 1MB se choti honi chahiye!');
  const ext = (file.name && file.name.split('.').pop()) || 'jpg';
  const path = `${employeeId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase
    .storage.from(PHOTO_BUCKET)
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);

  const { error } = await supabase.from('employees').update({ photo_url: publicUrl }).eq('id', String(employeeId));
  if (error) throw error;

  return { status: 'ok', photo_url: publicUrl };
}

// ─── manager config ─────────────────────────────────────────────────────────
export async function getManagerConfig() {
  const { data, error } = await supabase.from('manager_config').select('*');
  if (error) { console.error('getManagerConfig:', error); return []; }
  return data || [];
}

export async function updateManagerPassword(newPassword) {
  const { error } = await supabase
    .from('manager_config')
    .upsert({ key: 'manager_password', value: newPassword });
  if (error) throw error;
  return { status: 'ok' };
}

// ─── daily logs ─────────────────────────────────────────────────────────────
export async function getDailyLogs() {
  const { data, error } = await supabase.from('daily_logs').select('*');
  if (error) { console.error('getDailyLogs:', error); return []; }
  return data || [];
}

export async function submitDay(log) {
  const { error } = await supabase.from('daily_logs').upsert({
    id: log.id,
    employee_id: log.employee_id,
    employee_name: log.employee_name,
    date: log.date,
    office_in: log.office_in,
    office_out: log.office_out,
    submitted: true,
    submitted_at: new Date().toISOString(),
    total_productive_hours: log.total_productive_hours
  });
  if (error) throw error;
  return { status: 'ok' };
}

// ─── tasks ──────────────────────────────────────────────────────────────────
export async function getTasks() {
  const { data, error } = await supabase.from('tasks').select('*');
  if (error) { console.error('getTasks:', error); return []; }
  return data || [];
}

export async function saveTask(task) {
  const { error } = await supabase.from('tasks').upsert({
    id: task.id,
    daily_log_id: task.daily_log_id,
    employee_id: task.employee_id,
    employee_name: task.employee_name,
    date: task.date,
    task_name: task.task_name,
    start_time: task.start_time,
    end_time: task.end_time,
    break_time: Number(task.break_time) || 0,
    productive_hours: Number(task.productive_hours) || 0,
    status: task.status,
    notes: task.notes || '',
    manager_note: task.manager_note || '',
    is_assigned: task.is_assigned === true || task.is_assigned === 'true'
  });
  if (error) throw error;
  return { status: 'ok' };
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) throw error;
  return { status: 'ok' };
}

export async function approveTask(taskId, note) {
  const { error } = await supabase.from('tasks').update({ status: 'Approved', manager_note: note || '' }).eq('id', taskId);
  if (error) throw error;
  return { status: 'ok' };
}

export async function rejectTask(taskId, note) {
  const { error } = await supabase.from('tasks').update({ status: 'Rejected', manager_note: note || '' }).eq('id', taskId);
  if (error) throw error;
  return { status: 'ok' };
}

// ─── team chat ──────────────────────────────────────────────────────────────
// Latest `limit` messages, oldest first. Pass `before` (a created_at) to page further back.
export async function getMessages(limit = 200, before = null) {
  let query = supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) { console.error('getMessages:', error); return []; }
  return (data || []).reverse();
}

export async function sendMessage(msg) {
  const { error } = await supabase.from('messages').insert(msg);
  if (error) throw error;
  return { status: 'ok' };
}

export async function uploadChatFile(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('File 10MB se choti honi chahiye!');
  const safeName = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { cacheControl: '3600' });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(CHAT_BUCKET).getPublicUrl(path);
  return { url: publicUrl, name: file.name, type: file.type || '' };
}

// Calls onInsert(row) for every new message; returns an unsubscribe function
export function subscribeMessages(onInsert) {
  const channel = supabase
    .channel('team-chat')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => onInsert(payload.new))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
