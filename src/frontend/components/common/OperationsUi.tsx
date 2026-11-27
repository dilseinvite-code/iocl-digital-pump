import React from 'react';
import './operationsUi.css';
import { AlertCircle, CheckCircle2, Circle, Clock3, LockKeyhole } from 'lucide-react';

/** Presentation only. Each status comes from existing saved data. */
export function workflowTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status.trim().toUpperCase().replaceAll('_', ' ')) {
    case 'COMPLETE': case 'COMPLETED': case 'CLOSED': case 'LOCKED': case 'ALL CLOSED / LOCKED': return 'success';
    case 'BLOCKED': case 'REVIEW REQUIRED': return 'danger';
    case 'PARTIAL': case 'PENDING': case 'IN PROGRESS': case 'CLOSING': return 'warning';
    case 'OPEN': return 'info';
    default: return 'neutral';
  }
}

export function StatusPill({status, testId}: {status:string; testId?:string}) {
  const tone=workflowTone(status);
  const Icon=tone==='success'?(status==='CLOSED'||status==='LOCKED'||status==='ALL CLOSED / LOCKED'?LockKeyhole:CheckCircle2):tone==='danger'?AlertCircle:tone==='warning'||tone==='info'?Clock3:Circle;
  return <span className="ops-status-pill" data-tone={tone} data-testid={testId}>
    <Icon size={13} aria-hidden="true"/>{status.replaceAll('_',' ')}
  </span>;
}

export function StatusCard({label,status,description,testId}: {label:string;status:string;description?:string;testId?:string}) {
  return <div className="ops-status-card" data-tone={workflowTone(status)}>
    <p className="ops-status-label">{label}</p>
    <StatusPill status={status} testId={testId}/>
    {description&&<p className="ops-status-description">{description}</p>}
  </div>;
}

export function SectionTitle({step,title,description,action}: {step?:string;title:string;description?:string;action?:React.ReactNode}) {
  return <div className="ops-section-title">
    <div className="ops-section-title-main">
      {step&&<span aria-hidden="true" className="ops-section-number">{step}</span>}
      <div className="min-w-0"><h2>{title}</h2>{description&&<p>{description}</p>}</div>
    </div>
    {action}
  </div>;
}
