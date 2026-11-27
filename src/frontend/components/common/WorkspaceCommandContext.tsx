import { Activity, Building2, ChevronRight, ClipboardCheck, FileText, Fuel, GitBranch, Layers, LockKeyhole, MapPin, ShieldCheck, Users, Wrench, Zap, Receipt, Store } from 'lucide-react';
import { useActiveOutlet } from '../../context/ActiveOutletContext';
import { useAuth } from '../../context/AuthContext';
import { outletHierarchy, scopeLabel } from '../../utils/commandCentre';
import '../../pages/dailyOperationsModern.css';
import './workspaceCommandCentre.css';

const workspaces = {
  equipment: { area:'Compliance & outlet support', outlet:true, icon:Wrench, title:'Equipment reliability', detail:'Review equipment, breakdown tickets and DG running logs in their respective work areas.' },
  utilities: { area:'Compliance & outlet support', outlet:true, icon:Zap, title:'Electricity and utilities', detail:'Manage utility accounts, billing records, submeters and charges.' },
  municipal: { area:'Compliance & outlet support', outlet:true, icon:Receipt, title:'Statutory dues', detail:'Review municipal tax obligations and payment evidence for this outlet.' },
  nfr: { area:'Compliance & outlet support', outlet:true, icon:Store, title:'Non-fuel revenue', detail:'Manage commercial spaces, vendors, leases and rent dues.' },
  workforce: { area:'Compliance & outlet support', outlet:true, icon:Users, title:'Workforce records', detail:'Review staff records, attendance and the applicable workforce work areas.' },
  documents: { area:'Compliance & outlet support', outlet:true, icon:ClipboardCheck, title:'Compliance evidence', detail:'Use the register, masters, due dates and reports to review compliance records.' },
  pump: { area:'Outlet setup', outlet:true, icon:Fuel, title:'Outlet infrastructure', detail:'Maintain the outlet’s equipment and fuel infrastructure through the existing setup work areas.' },
  outlets: { area:'Outlet setup', outlet:false, icon:Building2, title:'Retail outlet directory', detail:'Review and manage outlet records within your authorized organizational scope.' },
  products: { area:'Outlet setup', outlet:false, icon:Fuel, title:'Product master', detail:'Manage product configuration using the existing master-data controls.' },
  users: { area:'Administration', outlet:false, icon:Users, title:'User administration', detail:'Review user accounts and their assigned roles using the existing access controls.' },
  scopes: { area:'Administration', outlet:false, icon:MapPin, title:'Scope assignments', detail:'Review and maintain organizational scope assignments for authorized users.' },
  hierarchy: { area:'Administration', outlet:false, icon:GitBranch, title:'Organizational hierarchy', detail:'Maintain state offices, divisions and sales areas in their respective work areas.' },
  organization: { area:'Administration', outlet:false, icon:Layers, title:'Organization masters', detail:'Review departments, officers, service providers and outlet assignments.' },
  rbac: { area:'Administration', outlet:false, icon:ShieldCheck, title:'Role-based access', detail:'Review roles and permissions using the existing authorization rules.' },
  audit: { area:'Administration', outlet:false, icon:Activity, title:'Audit and accountability', detail:'Review recorded system activity and filter the audit trail within your authorized access.' },
} as const;

const levels = ['GLOBAL','STATE','DIVISION','SALES_AREA','OUTLET'] as const;

/** Presentation only. The outlet path uses the authorized active outlet; directory
 * and administration pages describe account scope rather than an outlet filter.
 * No permissions, data access, or page handlers are changed here. */
export function WorkspaceCommandContext({module}: {module:keyof typeof workspaces}) {
  const { userCtx } = useAuth();
  const { activeOutletId, accessibleOutlets, loading } = useActiveOutlet();
  const config = workspaces[module];
  const Icon = config.icon;
  const scope = userCtx?.primaryScope;
  const outlet = config.outlet && !loading ? accessibleOutlets.find(o=>o.id===activeOutletId) : undefined;
  return <div className="workspace-command-context">
    <section aria-label="Workspace organization hierarchy" className="dc-panel dc-context">
      <div className="dc-hierarchy-head">
        <span className="dc-hierarchy-icon"><GitBranch size={18} aria-hidden="true"/></span>
        <div><h2>{config.outlet?'Organization hierarchy':'Authorized organizational scope'}</h2>
          <p>Primary access: <strong>{scope?scopeLabel(scope):'Unavailable'}</strong> · {config.outlet?'This workspace uses the selected authorized retail outlet.':'Organizational levels are shown for reference, not as additional access.'}</p>
        </div>
      </div>
      {config.outlet ? outlet ?
        <ol aria-label="Selected outlet hierarchy" className="dc-hierarchy-path">
          {outletHierarchy(outlet).map((node,index,all)=><li key={node.label}><span data-selected={index===all.length-1}><small>{node.label}</small><strong>{node.name}{node.code?' · '+node.code:''}</strong></span>{index<all.length-1&&<ChevronRight size={14} className="dc-chevron" aria-hidden="true"/>}</li>)}
        </ol> : <p className="workspace-context-note">{loading?'Loading authorized outlets…':'Select an authorized active outlet to view its hierarchy.'}</p> :
        <ol aria-label="Organizational scope levels" className="dc-hierarchy-path">
          {levels.map((level,index)=><li key={level}><span data-selected={scope===level}><small>{scope===level?'Primary access level':'Hierarchy level'}</small><strong>{scopeLabel(level)}</strong></span>{index<levels.length-1&&<ChevronRight size={14} className="dc-chevron" aria-hidden="true"/>}</li>)}
        </ol>}
    </section>
    <div className="dc-hero-grid">
      <section className="dc-hero" aria-label="Workspace context">
        <div className="dc-hero-content">
          <span className="dc-hero-tag"><Icon size={14} aria-hidden="true"/> {config.outlet?'SELECTED RETAIL OUTLET':'AUTHORIZED WORKSPACE'}</span>
          <div className="dc-hero-title">
            <div><h2>{config.outlet ? outlet?.name || (loading?'Loading outlet…':'No outlet selected') : scope ? scopeLabel(scope)+' access' : 'Organizational access'}</h2>
              <p>{config.outlet ? outlet ? 'RO '+outlet.roCode+' · '+config.area : config.area : config.area}</p></div>
            <span className="dc-hero-art" aria-hidden="true"><Icon size={48}/></span>
          </div>
        </div>
      </section>
      <section className="dc-attention" data-tone="info" aria-label="Workspace guidance">
        <div className="dc-attention-top"><span className="dc-attention-icon"><FileText size={20} aria-hidden="true"/></span>
          <div><div className="dc-attention-kicker">WORKSPACE GUIDANCE</div><p className="dc-attention-context">{config.area}</p></div>
        </div>
        <h3>{config.title}</h3><p>{config.detail}</p>
        <div className="workspace-guidance-footer"><LockKeyhole size={13} aria-hidden="true"/> Available actions follow assigned role and scope.</div>
      </section>
    </div>
  </div>;
}
