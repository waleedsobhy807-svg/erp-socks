/**
 * Employees & KPIs page — HR records, attendance, performance tracking.
 */
import { useState } from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useGet, usePost, usePut } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import Table from '../components/Table';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';

const statusColor = { active:'green', terminated:'red', on_leave:'yellow' };

function EmployeeForm({ initial={}, onSubmit, loading }) {
  const [f, setF] = useState({ emp_no:'', full_name:'', department:'', job_title:'', hire_date:'', gender:'other', phone:'', email:'', base_salary:'', currency:'USD', ...initial });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Emp No" required><input required value={f.emp_no} onChange={set('emp_no')} className="input" /></FormField>
        <FormField label="Full Name" required><input required value={f.full_name} onChange={set('full_name')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Department"><input value={f.department} onChange={set('department')} className="input" /></FormField>
        <FormField label="Job Title"><input value={f.job_title} onChange={set('job_title')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Hire Date"><input type="date" value={f.hire_date} onChange={set('hire_date')} className="input" /></FormField>
        <FormField label="Gender">
          <select value={f.gender} onChange={set('gender')} className="input">
            <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Phone"><input value={f.phone} onChange={set('phone')} className="input" /></FormField>
        <FormField label="Email"><input type="email" value={f.email} onChange={set('email')} className="input" /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Base Salary"><input type="number" min={0} value={f.base_salary} onChange={set('base_salary')} className="input" /></FormField>
        <FormField label="Currency">
          <select value={f.currency} onChange={set('currency')} className="input">
            {['USD','EUR','GBP','EGP','INR'].map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Saving…' : 'Save Employee'}</button>
      </div>
    </form>
  );
}

function EmployeePanel({ employee, onClose, onUpdate }) {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;
  const [tab, setTab] = useState('attendance');
  const [showAttForm, setShowAttForm] = useState(false);
  const [kpiModal, setKpiModal]       = useState(false);
  const [perfDates, setPerfDates]     = useState({ period_start:'', period_end:'' });

  const { data: attData,  refetch: refetchAtt  } = useGet(['emp-att',  employee.id], `/employees/${employee.id}/attendance`,  { limit: 20 });
  const { data: kpiData,  refetch: refetchKpi  } = useGet(['emp-kpi',  employee.id], `/employees/${employee.id}/kpi-results`);
  const { data: kpiDefs                         } = useGet('kpi-defs',  '/employees/kpis');
  const { data: perfData, refetch: refetchPerf  } = useGet(
    ['emp-perf', employee.id, perfDates.period_start, perfDates.period_end],
    `/employees/${employee.id}/performance`,
    { period_start: perfDates.period_start || undefined, period_end: perfDates.period_end || undefined },
    { enabled: !!(perfDates.period_start && perfDates.period_end) },
  );
  const { mutate: terminate, isPending: terminating } = usePost(`/employees/${employee.id}/terminate`);

  const attendance = attData?.data ?? attData ?? [];
  const kpiResults = kpiData?.data ?? kpiData ?? [];
  const kpiList    = kpiDefs?.data ?? kpiDefs ?? [];

  const attStatusColor = { present:'green', absent:'red', late:'yellow', half_day:'blue' };

  function [attForm, setAttForm] = useState({ date:'', check_in:'', check_out:'', status:'present', notes:'' });
  // Note: useState inside inline JSX is invalid — using a component instead
  function handleTerminate() {
    const termination_date = window.prompt('Termination date (YYYY-MM-DD):') || new Date().toISOString().slice(0,10);
    const reason           = window.prompt('Reason:');
    if (!reason) return;
    terminate({ termination_date, reason }, { onSuccess: () => { onClose(); onUpdate(); } });
  }

  const score = perfData?.overall_rating ?? perfData?.weighted_score;
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600';

  return (
    <div className="fixed inset-y-0 right-0 w-[28rem] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-900">{employee.full_name}</h2>
          <p className="text-xs text-gray-500">{employee.emp_no} · {employee.department} · {employee.job_title}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && employee.status !== 'terminated' && (
            <button onClick={handleTerminate} disabled={terminating} className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50">Terminate</button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="flex border-b border-gray-200">
        {['attendance','kpi','performance'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${tab===t ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tab === 'attendance' && (
          <>
            {attendance.map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-gray-700">{new Date(a.date).toLocaleDateString()}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">{a.check_in ?? '—'} → {a.check_out ?? '—'}</span>
                  <Badge label={a.status} color={attStatusColor[a.status] ?? 'gray'} />
                </div>
              </div>
            ))}
            {attendance.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No attendance records</p>}
            {canWrite && <AttendanceForm employeeId={employee.id} onDone={refetchAtt} />}
          </>
        )}
        {tab === 'kpi' && (
          <>
            {kpiResults.map(r => (
              <div key={r.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-800">{r.kpi_name ?? r.kpi_id}</span>
                  <span className={`font-bold ${r.score >= 80 ? 'text-green-600' : r.score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>{r.score?.toFixed(0)}%</span>
                </div>
                <div className="text-gray-500 text-xs mt-0.5">{r.period_start} → {r.period_end} · Actual: {r.actual_value}</div>
              </div>
            ))}
            {kpiResults.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No KPI records</p>}
            {canWrite && <button onClick={() => setKpiModal(true)} className="w-full btn-ghost text-sm flex items-center justify-center gap-1"><PlusIcon className="h-4 w-4" />Record KPI</button>}
          </>
        )}
        {tab === 'performance' && (
          <>
            <div className="flex gap-2">
              <input type="date" value={perfDates.period_start} onChange={e => setPerfDates(p => ({ ...p, period_start: e.target.value }))} className="input text-sm flex-1" />
              <input type="date" value={perfDates.period_end}   onChange={e => setPerfDates(p => ({ ...p, period_end:   e.target.value }))} className="input text-sm flex-1" />
            </div>
            {perfData ? (
              <div className="space-y-3 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Overall Score</span>
                  <span className={`text-2xl font-bold ${scoreColor}`}>{score?.toFixed(1) ?? '—'}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Attendance Rate</span>
                  <span className="text-gray-900">{perfData.attendance_rate?.toFixed(1) ?? '—'}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Weighted KPI</span>
                  <span className="text-gray-900">{perfData.weighted_score?.toFixed(1) ?? '—'}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">Select a date range to view performance</p>
            )}
          </>
        )}
      </div>

      {/* KPI record modal */}
      <Modal open={kpiModal} onClose={() => setKpiModal(false)} title="Record KPI Result" size="md">
        <KPIForm employeeId={employee.id} kpiList={kpiList} onDone={() => { setKpiModal(false); refetchKpi(); }} />
      </Modal>
    </div>
  );
}

function AttendanceForm({ employeeId, onDone }) {
  const [f, setF] = useState({ date:'', check_in:'', check_out:'', status:'present', notes:'' });
  const { mutate, isPending } = usePost(`/employees/${employeeId}/attendance`);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" required value={f.date} onChange={set('date')} className="input text-sm" />
        <select value={f.status} onChange={set('status')} className="input text-sm">
          <option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="half_day">Half Day</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="time" placeholder="Check in" value={f.check_in} onChange={set('check_in')} className="input text-sm" />
        <input type="time" placeholder="Check out" value={f.check_out} onChange={set('check_out')} className="input text-sm" />
      </div>
      <input placeholder="Notes" value={f.notes} onChange={set('notes')} className="input text-sm" />
      <button onClick={() => mutate(f, { onSuccess: onDone })} disabled={isPending} className="w-full btn-primary text-sm">{isPending ? 'Saving…' : 'Record Attendance'}</button>
    </div>
  );
}

function KPIForm({ employeeId, kpiList, onDone }) {
  const [f, setF] = useState({ kpi_id:'', period_start:'', period_end:'', actual_value:'', notes:'' });
  const { mutate, isPending } = usePost(`/employees/${employeeId}/kpi-results`);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate(f, { onSuccess: onDone }); }} className="space-y-4">
      <FormField label="KPI" required>
        <select required value={f.kpi_id} onChange={set('kpi_id')} className="input">
          <option value="">Select KPI…</option>
          {kpiList.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Period Start"><input type="date" required value={f.period_start} onChange={set('period_start')} className="input" /></FormField>
        <FormField label="Period End">  <input type="date" required value={f.period_end}   onChange={set('period_end')}   className="input" /></FormField>
      </div>
      <FormField label="Actual Value"><input required type="number" value={f.actual_value} onChange={set('actual_value')} className="input" /></FormField>
      <FormField label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} className="input" /></FormField>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={isPending} className="btn-primary">{isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function Employees() {
  const { isAdmin, isManager } = useAuth();
  const canWrite = isAdmin || isManager;

  const [dept, setDept]         = useState('');
  const [status, setStatus]     = useState('active');
  const [page, setPage]         = useState(1);
  const [modalOpen, setModal]   = useState(false);
  const [selected, setSelected] = useState(null);

  const { data, isLoading, refetch } = useGet(
    ['employees', dept, status, page],
    '/employees',
    { department: dept || undefined, status: status || undefined, page, limit: 20 },
  );
  const { mutate: createMutate, isPending: creating } = usePost('/employees');

  const employees  = data?.data  ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const columns = [
    { key:'emp_no',     label:'Emp#' },
    { key:'full_name',  label:'Name' },
    { key:'department', label:'Department' },
    { key:'job_title',  label:'Job Title' },
    { key:'hire_date',  label:'Hired', render: r => r.hire_date ? new Date(r.hire_date).toLocaleDateString() : '—' },
    { key:'status',     label:'Status', render: r => <Badge label={r.status ?? 'active'} color={statusColor[r.status] ?? 'green'} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees & KPIs"
        subtitle={`${total} employees`}
        actions={canWrite && (
          <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />Add Employee
          </button>
        )}
      />

      <div className="flex flex-wrap gap-3">
        <input value={dept} onChange={e => { setDept(e.target.value); setPage(1); }} placeholder="Filter by department…" className="input w-52" />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="input w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="terminated">Terminated</option>
          <option value="on_leave">On Leave</option>
        </select>
      </div>

      <Table columns={columns} data={employees} loading={isLoading} emptyText="No employees found" page={page} totalPages={totalPages} onPageChange={setPage} onRowClick={setSelected} />

      <Modal open={modalOpen} onClose={() => setModal(false)} title="Add Employee" size="lg">
        <EmployeeForm onSubmit={f => createMutate(f, { onSuccess: () => { setModal(false); refetch(); } })} loading={creating} />
      </Modal>

      {selected && <EmployeePanel employee={selected} onClose={() => setSelected(null)} onUpdate={refetch} />}
    </div>
  );
}
