import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,Search,X} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {findWorkspaceTasks,openWorkspaceTask,WORKSPACE_TASKS,type WorkspaceTask} from './workspaceTaskCatalog';

export function WorkspaceTaskFinder({activeTab,onNavigate,compact=false}:{activeTab:string;onNavigate:(tab:string)=>void;compact?:boolean}){
 const {hasPermission}=useAuth();
 const [open,setOpen]=useState(false);
 const [query,setQuery]=useState('');
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 useEffect(()=>{setOpen(false);setQuery('');},[activeTab]);
 const matches=query.trim()?findWorkspaceTasks(query,hasPermission,8):
   WORKSPACE_TASKS.filter(t=>t.tab===activeTab&&t.permissions.every(hasPermission)).slice(0,6);
 const select=(task:WorkspaceTask)=>{openWorkspaceTask(task,onNavigate);setOpen(false);setQuery('');};
 return <div className={compact?"cc-task-finder":"mb-4 rounded-xl border border-[#D7E0EA] bg-white shadow-sm"} data-testid="workspace-task-finder">
   <div className={compact?"cc-task-finder-trigger":"flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"}>
     {!compact&&<p className="min-w-0 text-xs text-[#64748B]"><span className="font-bold text-[#17365D]">Quick navigation</span> · Find a task without searching every menu</p>}
     <button type="button" aria-expanded={open} aria-controls="iocl-workspace-task-results"
       onClick={()=>setOpen(v=>!v)}
       className={compact?"cc-task-finder-button":"inline-flex items-center gap-2 rounded-lg border border-[#D7E0EA] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#17365D]"}>
       {open?<X className="h-4 w-4"/>:<Search className="h-4 w-4"/>}{open?'Close':'Find a task'}
     </button>
   </div>
   {open&&<div id="iocl-workspace-task-results" className={compact?"cc-task-finder-results":"space-y-2 border-t border-[#E2E8F0] p-3"}>
     <label htmlFor="iocl-workspace-task-query" className="block text-xs font-semibold text-[#475569]">Search tasks (e.g. tank calibration, bank deposit, licence expiry)</label>
     <input ref={input} type="search" id="iocl-workspace-task-query" value={query}
       onChange={e=>setQuery(e.target.value)}
       onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setQuery('');}}}
       placeholder="What do you need to do?"
       className="w-full rounded-lg border border-[#D7E0EA] bg-white px-3 py-2 text-sm text-[#17365D] focus:border-[#F47721] focus:outline-none"/>
     <div className={compact?"grid gap-1":"grid gap-1 sm:grid-cols-2 xl:grid-cols-3"}>
       {matches.map(task=><button key={task.id} type="button" onClick={()=>select(task)}
         className="flex items-start justify-between gap-2 rounded-lg border border-transparent p-3 text-left hover:border-[#D7E0EA] hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-orange-500">
         <span><span className="block text-sm font-semibold text-[#17365D]">{task.label}</span>
           <span className="block text-xs text-[#64748B]">{task.description}</span></span>
         <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#B8530D]"/>
       </button>)}
     </div>
     {matches.length===0&&<p role="status" className="text-sm text-[#64748B]">No accessible tasks found. Try another keyword.</p>}
   </div>}
 </div>;
}
