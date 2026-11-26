import {createElement} from 'react';
import {CalendarDays,CheckSquare2,Menu,PanelLeftClose,PanelLeftOpen,Search,Settings,type LucideProps} from 'lucide-react';

// The app's pinned Lucide icons use the existing ISC and Feather MIT notices.
// Explicit pixels keep shared navigation marks consistent across shell font densities.
const navigationIcon = {size:19,strokeWidth:2,className:'size-[19px]','aria-hidden':true} as const;

export const ScheduleNavigationIcon = (props:LucideProps) => createElement(CalendarDays,{...props,...navigationIcon});
export const TodoNavigationIcon = (props:LucideProps) => createElement(CheckSquare2,{...props,...navigationIcon});
export const OpenNavigationIcon = (props:LucideProps) => createElement(Menu,{...props,...navigationIcon});
export const CollapseSidebarIcon = (props:LucideProps) => createElement(PanelLeftClose,{...props,...navigationIcon});
export const ExpandSidebarIcon = (props:LucideProps) => createElement(PanelLeftOpen,{...props,...navigationIcon});
export const SearchNavigationIcon = (props:LucideProps) => createElement(Search,{...props,...navigationIcon});
export const SettingsNavigationIcon = (props:LucideProps) => createElement(Settings,{...props,...navigationIcon});
