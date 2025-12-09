
import { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  format, 
  addDays, 
  isBefore, 
  isAfter, 
  differenceInCalendarDays, 
  startOfMonth, 
  endOfMonth, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  addMonths,
  isWithinInterval
} from 'date-fns';

// --- POLYFILLS FOR MISSING IMPORTS ---

function parseISO(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Ensure subDays is available
// Note: importing subDays from date-fns might fail in some environments if not explicitly listed in importmap, 
// so we keep the polyfill/wrapper or use addDays(-n)
function subDaysPolyfill(date: Date, amount: number): Date {
  return addDays(date, -amount);
}

function startOfWeekPolyfill(date: Date, options: { weekStartsOn: number }): Date {
  const weekStartsOn = options.weekStartsOn;
  const day = date.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  return addDays(date, -diff);
}

// Helper to get months in interval
function eachMonthOfIntervalPolyfill({ start, end }: { start: Date, end: Date }): Date[] {
  const months: Date[] = [];
  let current = startOfMonth(start);
  while (isBefore(current, end) || isSameMonth(current, end)) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}

// --- TYPES ---

type Trip = {
  id: string;
  entryDate: string; // ISO YYYY-MM-DD
  exitDate: string;  // ISO YYYY-MM-DD
};

type Profile = {
  id: string;
  name: string;
  trips: Trip[];
};

// --- CONSTANTS ---
const DISPLAY_DATE_FORMAT = 'dd/MM/yyyy';

// --- LOGIC (Pure TypeScript) ---

function normalizeTrips(trips: Trip[]): Trip[] {
  if (trips.length === 0) return [];

  // Sort by entry date
  const sorted = [...trips].sort((a, b) => 
    a.entryDate.localeCompare(b.entryDate)
  );

  const normalized: Trip[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    
    // Check overlap or adjacency (end date + 1 day >= next start date)
    const currentEnd = parseISO(current.exitDate);
    const nextStart = parseISO(next.entryDate);
    const adjacentDate = addDays(currentEnd, 1);

    if (isBefore(nextStart, adjacentDate) || nextStart.toISOString() === adjacentDate.toISOString()) {
      // Merge
      const maxExit = isAfter(parseISO(next.exitDate), currentEnd) ? next.exitDate : current.exitDate;
      current = { ...current, exitDate: maxExit };
    } else {
      normalized.push(current);
      current = next;
    }
  }
  normalized.push(current);
  return normalized;
}

function calculateUsedDaysWithinWindow(trips: Trip[], referenceDate: string): number {
  const refDateObj = parseISO(referenceDate);
  const windowStart = subDaysPolyfill(refDateObj, 179);
  
  let daysUsed = 0;

  for (const trip of trips) {
    const tripStart = parseISO(trip.entryDate);
    const tripEnd = parseISO(trip.exitDate);

    // Calculate intersection of [tripStart, tripEnd] and [windowStart, refDate]
    const overlapStart = isBefore(tripStart, windowStart) ? windowStart : tripStart;
    const overlapEnd = isAfter(tripEnd, refDateObj) ? refDateObj : tripEnd;

    if (!isAfter(overlapStart, overlapEnd)) {
      daysUsed += differenceInCalendarDays(overlapEnd, overlapStart) + 1;
    }
  }

  return daysUsed;
}

function canStayForPeriod(
  existingTrips: Trip[],
  plannedEntry: string,
  plannedExit: string
): { 
  isAllowed: boolean; 
  violationDate: string | null;
  usedOnExit: number; 
} {
  const tempTrip: Trip = { id: 'temp', entryDate: plannedEntry, exitDate: plannedExit };
  const combinedTrips = normalizeTrips([...existingTrips, tempTrip]);
  
  const start = parseISO(plannedEntry);
  const end = parseISO(plannedExit);
  const days = differenceInCalendarDays(end, start) + 1;

  for (let i = 0; i < days; i++) {
    const checkDate = addDays(start, i);
    const dateStr = format(checkDate, 'yyyy-MM-dd');
    const used = calculateUsedDaysWithinWindow(combinedTrips, dateStr);
    
    if (used > 90) {
      return { 
        isAllowed: false, 
        violationDate: format(parseISO(dateStr), DISPLAY_DATE_FORMAT), 
        usedOnExit: used 
      };
    }
  }

  const finalUsed = calculateUsedDaysWithinWindow(combinedTrips, plannedExit);

  return { 
    isAllowed: true, 
    violationDate: null, 
    usedOnExit: finalUsed 
  };
}

function getMaxSafeStayFromDate(trips: Trip[], plannedEntry: string): { maxDays: number; untilDate: string } {
  let safeLength = 0;
  
  for (let i = 1; i <= 90; i++) {
    const currentExit = addDays(parseISO(plannedEntry), i - 1);
    const currentExitStr = format(currentExit, 'yyyy-MM-dd');
    
    const check = canStayForPeriod(trips, plannedEntry, currentExitStr);
    if (!check.isAllowed) {
      break;
    }
    safeLength = i;
  }

  return {
    maxDays: safeLength,
    untilDate: format(addDays(parseISO(plannedEntry), safeLength - 1), DISPLAY_DATE_FORMAT)
  };
}

// --- STATE MANAGEMENT ---

const STORAGE_KEY = 'schengen_calculator_data';
const MAX_PROFILES = 20;

function useSchengenStore() {
  const [profiles, setProfiles] = useState<Profile[]>([{ id: 'default', name: 'Me', trips: [] }]);
  const [activeProfileId, setActiveProfileId] = useState<string>('default');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const load = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          setProfiles(data.profiles);
          setActiveProfileId(data.activeProfileId);
        }
      } catch (e) {
        console.error("Failed to load data", e);
      } finally {
        setIsLoaded(true);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles, activeProfileId }));
    }
  }, [profiles, activeProfileId, isLoaded]);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

  const addProfile = (name: string) => {
    if (profiles.length >= MAX_PROFILES) return;
    const newId = crypto.randomUUID();
    setProfiles([...profiles, { id: newId, name, trips: [] }]);
    setActiveProfileId(newId);
  };

  const removeProfile = (id: string) => {
    if (profiles.length <= 1) return;
    const newProfiles = profiles.filter(p => p.id !== id);
    setProfiles(newProfiles);
    if (activeProfileId === id) {
      setActiveProfileId(newProfiles[0].id);
    }
  };

  const updateTripsFromSet = (profile: Profile, dateSet: Set<string>): Profile => {
      const sortedDates = Array.from(dateSet).sort();
      
      if (sortedDates.length === 0) return { ...profile, trips: [] };

      const newTrips: Trip[] = [];
      let tripStart = sortedDates[0];
      let tripPrev = sortedDates[0];

      for (let i = 1; i < sortedDates.length; i++) {
        const curr = sortedDates[i];
        const prevDate = parseISO(tripPrev);
        const currDate = parseISO(curr);
        
        if (differenceInCalendarDays(currDate, prevDate) === 1) {
          tripPrev = curr;
        } else {
          newTrips.push({ id: crypto.randomUUID(), entryDate: tripStart, exitDate: tripPrev });
          tripStart = curr;
          tripPrev = curr;
        }
      }
      newTrips.push({ id: crypto.randomUUID(), entryDate: tripStart, exitDate: tripPrev });

      return { ...profile, trips: newTrips };
  };

  const toggleDate = (dateStr: string) => {
    setProfiles(prev => prev.map(p => {
      if (p.id !== activeProfileId) return p;

      const dateSet = new Set<string>();
      p.trips.forEach(t => {
        const start = parseISO(t.entryDate);
        const end = parseISO(t.exitDate);
        const days = differenceInCalendarDays(end, start);
        for(let i=0; i<=days; i++) {
          dateSet.add(format(addDays(start, i), 'yyyy-MM-dd'));
        }
      });

      if (dateSet.has(dateStr)) dateSet.delete(dateStr);
      else dateSet.add(dateStr);

      return updateTripsFromSet(p, dateSet);
    }));
  };

  const addTripRange = (startDateStr: string, endDateStr: string) => {
    setProfiles(prev => prev.map(p => {
      if (p.id !== activeProfileId) return p;

      const dateSet = new Set<string>();
      // 1. Existing dates
      p.trips.forEach(t => {
        const start = parseISO(t.entryDate);
        const end = parseISO(t.exitDate);
        const days = differenceInCalendarDays(end, start);
        for(let i=0; i<=days; i++) {
          dateSet.add(format(addDays(start, i), 'yyyy-MM-dd'));
        }
      });

      // 2. Add range
      const d1 = parseISO(startDateStr);
      const d2 = parseISO(endDateStr);
      // Handle either order of clicking
      const start = isBefore(d1, d2) ? d1 : d2;
      const end = isAfter(d1, d2) ? d1 : d2;
      
      const interval = eachDayOfInterval({ start, end });
      interval.forEach((d: Date) => dateSet.add(format(d, 'yyyy-MM-dd')));

      return updateTripsFromSet(p, dateSet);
    }));
  };

  return { profiles, activeProfileId, activeProfile, setActiveProfileId, addProfile, removeProfile, toggleDate, addTripRange };
}

// --- COMPONENTS ---

// Helper for popup calendar logic
const CalendarPicker = ({ 
  selectedDateStr, 
  minDateStr, 
  onSelect 
}: { 
  selectedDateStr: string, 
  minDateStr?: string, 
  onSelect: (date: string) => void 
}) => {
  const [viewDate, setViewDate] = useState(() => parseISO(selectedDateStr));
  
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeekPolyfill(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: startDate, end: endDate });
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const nextMonth = () => setViewDate(addMonths(viewDate, 1));
  const prevMonth = () => setViewDate(addMonths(viewDate, -1));

  return (
    <div className="p-4 w-72">
      <div className="flex justify-between items-center mb-4">
        <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronLeft /></button>
        <span className="font-bold text-gray-800">{format(viewDate, "MMMM yyyy")}</span>
        <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronRight /></button>
      </div>
      
      <div className="grid grid-cols-7 mb-2">
        {dayLabels.map(d => <div key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {allDays.map((day: Date) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isSelected = dateStr === selectedDateStr;
          const isCurrentMonth = isSameMonth(day, monthStart);
          const isDisabled = minDateStr ? isBefore(day, parseISO(minDateStr)) : false;

          return (
            <button
              key={dateStr}
              disabled={isDisabled}
              onClick={() => onSelect(dateStr)}
              className={`
                h-8 rounded-full text-xs font-medium transition-all
                ${isDisabled ? 'text-gray-200 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer'}
                ${isSelected ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md' : isCurrentMonth && !isDisabled ? 'text-gray-700' : 'text-gray-300'}
              `}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Custom Date Input Popup
const DateInput = ({ 
  label, 
  value, 
  onChange, 
  min,
  className
}: { 
  label?: string, 
  value: string, 
  onChange: (d: string) => void, 
  min?: string,
  className?: string
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const displayValue = value ? format(parseISO(value), DISPLAY_DATE_FORMAT) : 'Select Date';
  
  return (
    <div className={`space-y-2 relative group ${className || ''}`}>
      {label && <label className="text-xs font-bold uppercase text-gray-400 tracking-wider pointer-events-none">{label}</label>}
      
      <div 
        onClick={() => setIsOpen(true)}
        className="w-full p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-blue-400 hover:ring-2 hover:ring-blue-100 transition-all font-mono text-gray-700 font-medium flex justify-between items-center cursor-pointer"
      >
        <span>{displayValue}</span>
        <CalendarIcon />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-100 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
             <CalendarPicker 
                selectedDateStr={value} 
                minDateStr={min} 
                onSelect={(d) => { onChange(d); setIsOpen(false); }} 
             />
          </div>
        </>
      )}
    </div>
  );
};

const CalendarView = ({ 
  markedDates, 
  onDatePress, 
  isRangeMode,
  rangeStart,
  onToggleRangeMode,
  referenceDate
}: { 
  markedDates: Set<string>, 
  onDatePress: (d: string) => void,
  isRangeMode: boolean,
  rangeStart: string | null,
  onToggleRangeMode: () => void,
  referenceDate: string
}) => {
  const [viewDate, setViewDate] = useState(() => parseISO(referenceDate));

  // Update view only when the reference date STRING changes (user selects a new reference date)
  // This prevents the view from resetting when the parent re-renders due to trip updates
  useEffect(() => {
    setViewDate(parseISO(referenceDate));
  }, [referenceDate]);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeekPolyfill(monthStart, { weekStartsOn: 1 }); // ISO week starts Monday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const dateFormat = "d";
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const allDays = eachDayOfInterval({ start: startDate, end: endDate });

  const nextMonth = () => setViewDate(addMonths(viewDate, 1));
  const prevMonth = () => setViewDate(addMonths(viewDate, -1));
  
  // 180 day window calculation for visualization
  const refDateObj = parseISO(referenceDate);
  const windowStart = subDaysPolyfill(refDateObj, 179);

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-6 transition-colors ${isRangeMode ? 'border-blue-300 ring-4 ring-blue-50/50' : 'border-gray-100'}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronLeft />
        </button>
        <div className="flex flex-col items-center">
          <span className="font-bold text-xl text-gray-800">
            {format(viewDate, "MMMM yyyy")}
          </span>
          <button 
            onClick={onToggleRangeMode}
            className={`text-xs font-bold px-4 py-1.5 mt-2 rounded-full transition-colors ${
              isRangeMode 
                ? 'bg-blue-600 text-white shadow-md' 
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {isRangeMode ? (rangeStart ? "Tap End Date" : "Tap Start Date") : "Select Range"}
          </button>
        </div>
        <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronRight />
        </button>
      </div>

      {/* Week Labels */}
      <div className="grid grid-cols-7 mb-4">
        {dayLabels.map(day => (
          <div key={day} className="text-center text-xs font-bold text-gray-400 uppercase tracking-wider">
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-2">
        {allDays.map((day: Date) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isSelected = markedDates.has(dateStr);
          const isCurrentMonth = isSameMonth(day, monthStart);
          const isRangeStart = rangeStart === dateStr;
          
          // Window visualization
          const isInWindow = isWithinInterval(day, { start: windowStart, end: refDateObj });
          const isRefDate = dateStr === referenceDate;

          return (
            <div 
              key={dateStr}
              onClick={() => onDatePress(dateStr)}
              className={`
                h-10 lg:h-12 flex items-center justify-center rounded-lg text-sm font-medium cursor-pointer transition-all relative
                ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700'}
                ${isSelected ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-gray-100'}
                ${isRefDate ? 'ring-2 ring-red-400 ring-offset-2 z-10' : ''}
                ${isRangeStart ? 'ring-4 ring-blue-200 z-10 font-bold bg-blue-700 text-white' : ''}
                ${isInWindow && !isSelected && isCurrentMonth ? 'bg-gray-50' : ''}
              `}
            >
              {format(day, dateFormat)}
              {isRefDate && <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"></div>}
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-4 mt-4 text-[10px] text-gray-400 font-medium">
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div>Reference Date</div>
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-gray-100 border border-gray-200"></div>180-Day Window</div>
      </div>
    </div>
  );
};

// --- NEW COMPONENT: Window Breakdown ---
const WindowBreakdown = ({ trips, referenceDate }: { trips: Trip[], referenceDate: string }) => {
  const refDateObj = parseISO(referenceDate);
  const windowStart = subDaysPolyfill(refDateObj, 179);
  
  // 1. Calculate Months in Window
  const monthsInWindow = useMemo(() => {
    try {
      return eachMonthOfIntervalPolyfill({ start: windowStart, end: refDateObj });
    } catch (e) {
      return [];
    }
  }, [windowStart, refDateObj]);

  // 2. Count days per month
  const monthStats = useMemo(() => {
    return monthsInWindow.map(month => {
      let count = 0;
      const mStart = startOfMonth(month);
      const mEnd = endOfMonth(month);

      // We only care about the intersection of (Month) AND (Window)
      // So effective search range is [max(mStart, windowStart), min(mEnd, refDateObj)]
      
      const searchStart = isBefore(mStart, windowStart) ? windowStart : mStart;
      const searchEnd = isAfter(mEnd, refDateObj) ? refDateObj : mEnd;

      // Iterate days in this clipped range to check if user was present
      if (!isAfter(searchStart, searchEnd)) {
         const days = eachDayOfInterval({ start: searchStart, end: searchEnd });
         days.forEach((d: Date) => {
           // Simple check if d is in any trip
           // Optimization: we could use a Set, but trips array is small enough usually
           const isPresent = trips.some(t => {
             const tStart = parseISO(t.entryDate);
             const tEnd = parseISO(t.exitDate);
             return !isBefore(d, tStart) && !isAfter(d, tEnd);
           });
           if (isPresent) count++;
         });
      }
      return { month, count };
    });
  }, [monthsInWindow, trips, windowStart, refDateObj]);

  // 3. Violation Detection (Exact Days)
  const violationDays = useMemo(() => {
    const violations: string[] = [];
    // Iterate all days in the window where user is present
    // For each present day, calculate the rolling 180 day count ENDING on that day.
    // If > 90, it's a violation.
    
    // First, gather all present days in the window
    const presentDaysInWindow: Date[] = [];
    const checkDays = eachDayOfInterval({ start: windowStart, end: refDateObj });
    
    checkDays.forEach((d: Date) => {
       const isPresent = trips.some(t => {
         const tStart = parseISO(t.entryDate);
         const tEnd = parseISO(t.exitDate);
         return !isBefore(d, tStart) && !isAfter(d, tEnd);
       });
       if (isPresent) presentDaysInWindow.push(d);
    });

    // Check violations
    presentDaysInWindow.forEach(d => {
      const dStr = format(d, 'yyyy-MM-dd');
      const used = calculateUsedDaysWithinWindow(trips, dStr);
      if (used > 90) {
        violations.push(dStr);
      }
    });

    return violations;
  }, [trips, windowStart, refDateObj]);

  return (
    <div className="mt-6 bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-gray-900 font-bold text-lg">180-Day Window Breakdown</h3>
          <p className="text-gray-500 text-xs mt-1">
             Window: <span className="font-mono bg-gray-100 px-1 rounded">{format(windowStart, DISPLAY_DATE_FORMAT)}</span> – <span className="font-mono bg-gray-100 px-1 rounded">{format(refDateObj, DISPLAY_DATE_FORMAT)}</span>
          </p>
        </div>
      </div>

      {/* Violation Alert */}
      {violationDays.length > 0 && (
        <div className="mb-8 bg-red-50 border border-red-100 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-red-200 text-red-700 p-1 rounded"><AlertIcon /></div>
            <h4 className="font-bold text-red-900">Overstay Detected!</h4>
          </div>
          <p className="text-sm text-red-700 mb-2">
            You exceeded the 90-day limit by <span className="font-bold">{violationDays.length} days</span> on the following dates within this window:
          </p>
          <div className="flex flex-wrap gap-2">
            {violationDays.map(v => (
              <span key={v} className="text-xs font-bold text-red-600 bg-white border border-red-200 px-2 py-1 rounded">
                {format(parseISO(v), 'dd MMM')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {monthStats.map(({ month, count }) => {
           const daysInMonth = differenceInCalendarDays(endOfMonth(month), startOfMonth(month)) + 1;
           // Max bars is roughly 31.
           return (
             <div key={month.toISOString()} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <div className="text-xs font-bold text-gray-500 uppercase mb-2">{format(month, 'MMMM')}</div>
                <div className="text-2xl font-black text-gray-800 mb-2">{count}<span className="text-xs font-medium text-gray-400"> days</span></div>
                
                {/* Mini Bar Chart */}
                <div className="flex gap-[2px] h-6 items-end">
                   {/* Create small bars representing roughly 2 days each or 1 day each */}
                   <div className="w-full bg-gray-200 rounded-sm h-1.5 overflow-hidden">
                      <div className={`h-full ${count > 20 ? 'bg-orange-400' : 'bg-blue-400'}`} style={{ width: `${(count / daysInMonth) * 100}%` }}></div>
                   </div>
                </div>
             </div>
           );
        })}
      </div>
    </div>
  );
};

// --- ICONS ---
const ChevronLeft = () => <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>;
const ChevronRight = () => <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>;
const CalendarIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const CalculatorIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>;
const UserIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>;
const InfoIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const CheckIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
const AlertIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

// --- SCREENS ---

const DashboardScreen = ({ store }: { store: ReturnType<typeof useSchengenStore> }) => {
  const [refDate, setRefDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const { activeProfile, toggleDate, addTripRange } = store;
  
  // Range selection state
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);

  // Stats
  const usedDays = calculateUsedDaysWithinWindow(activeProfile.trips, refDate);
  const remaining = Math.max(0, 90 - usedDays);
  
  // Future
  const planningStart = addDays(parseISO(refDate), 1);
  const planningStartStr = format(planningStart, 'yyyy-MM-dd');
  const maxStay = getMaxSafeStayFromDate(activeProfile.trips, planningStartStr);

  const statusColor = remaining === 0 ? 'text-red-600' : remaining <= 10 ? 'text-orange-500' : 'text-emerald-500';
  const statusBg = remaining === 0 ? 'bg-red-50' : remaining <= 10 ? 'bg-orange-50' : 'bg-emerald-50';

  const markedDates = useMemo(() => {
    const set = new Set<string>();
    activeProfile.trips.forEach(t => {
      const start = parseISO(t.entryDate);
      const end = parseISO(t.exitDate);
      const days = differenceInCalendarDays(end, start);
      for(let i=0; i<=days; i++) {
        set.add(format(addDays(start, i), 'yyyy-MM-dd'));
      }
    });
    return set;
  }, [activeProfile.trips]);

  const isPresentOnRefDate = markedDates.has(refDate);

  const handleDatePress = (dateStr: string) => {
    if (rangeMode) {
      if (!rangeStart) {
        setRangeStart(dateStr);
      } else {
        addTripRange(rangeStart, dateStr);
        setRangeStart(null);
        setRangeMode(false);
      }
    } else {
      toggleDate(dateStr);
    }
  };

  const toggleRangeMode = () => {
    setRangeMode(!rangeMode);
    setRangeStart(null);
  };

  return (
    <div>
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-2">Dashboard</h1>
          <p className="text-gray-500 text-sm">Monitor your 90/180 day allowance.</p>
        </div>

        <div className="flex items-center gap-4 bg-white p-2 rounded-xl border border-gray-200 shadow-sm self-start md:self-auto">
           <div className="w-44">
             <DateInput 
               label="Reference Date" 
               value={refDate} 
               onChange={setRefDate}
               className="scale-90 origin-top-left -mb-1"
             />
           </div>
           
           <div className="h-10 w-px bg-gray-100 mx-2"></div>
           
           <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">Location on Date</span>
              <div className="flex bg-gray-100 p-1 rounded-lg">
                 <button 
                   onClick={() => isPresentOnRefDate && toggleDate(refDate)}
                   className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${!isPresentOnRefDate ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
                 >
                   <span>🏠</span> Outside
                 </button>
                 <button 
                   onClick={() => !isPresentOnRefDate && toggleDate(refDate)}
                   className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${isPresentOnRefDate ? 'bg-blue-600 shadow text-white' : 'text-gray-400 hover:text-gray-600'}`}
                 >
                   <span>✈️</span> Inside
                 </button>
              </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Stats */}
        <div className="space-y-6">
          <div className={`rounded-xl p-6 shadow-sm border border-gray-100 bg-white`}>
            <h2 className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-4">
              Status as of {format(parseISO(refDate), DISPLAY_DATE_FORMAT)}
            </h2>
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-4xl font-black text-gray-800 tracking-tight">{usedDays}<span className="text-xl text-gray-400 font-medium">/90</span></div>
                  <div className="text-xs font-bold text-gray-400 mt-1 uppercase">Days Used</div>
                </div>
                <div className={`h-16 w-16 rounded-full flex items-center justify-center ${statusBg}`}>
                  <div className={`text-2xl font-bold ${statusColor}`}>
                    {Math.round((usedDays / 90) * 100)}%
                  </div>
                </div>
              </div>
              
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div 
                  className={`h-3 rounded-full transition-all duration-500 ${remaining === 0 ? 'bg-red-500' : remaining <= 10 ? 'bg-orange-400' : 'bg-blue-500'}`} 
                  style={{ width: `${Math.min(100, (usedDays/90)*100)}%` }}
                ></div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <div className={`text-3xl font-black ${statusColor}`}>{remaining}</div>
                <div className="text-xs font-bold text-gray-400 mt-1 uppercase">Days Remaining</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-3">Planning Ahead</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              If you enter on <span className="font-bold text-gray-900">{format(planningStart, DISPLAY_DATE_FORMAT)}</span>, 
              you can stay for <span className="font-bold text-blue-600">{maxStay.maxDays} days</span> (until {maxStay.untilDate}).
            </p>
          </div>
        </div>

        {/* Right Col: Calendar */}
        <div className="lg:col-span-2">
          <CalendarView 
            markedDates={markedDates}
            onDatePress={handleDatePress}
            isRangeMode={rangeMode}
            rangeStart={rangeStart}
            onToggleRangeMode={toggleRangeMode}
            referenceDate={refDate}
          />
          <p className="text-center text-xs text-gray-400 mt-3">
            {rangeMode 
              ? rangeStart ? "Select the last day of your trip" : "Select the first day of your trip" 
              : "Click dates to toggle history, or use 'Select Range'"
            }
          </p>
        </div>
      </div>

      {/* NEW SECTION: Window Breakdown */}
      <WindowBreakdown trips={activeProfile.trips} referenceDate={refDate} />
    </div>
  );
};

const CalculatorScreen = ({ store }: { store: ReturnType<typeof useSchengenStore> }) => {
  const [entry, setEntry] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [exit, setExit] = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [result, setResult] = useState<any>(null);

  // Auto-calculate when dates change
  useEffect(() => {
    if (entry && exit) {
      const start = parseISO(entry);
      const end = parseISO(exit);
      if (!isBefore(end, start)) {
        const res = canStayForPeriod(store.activeProfile.trips, entry, exit);
        setResult(res);
      } else {
        setResult(null);
      }
    }
  }, [entry, exit, store.activeProfile.trips]);

  const duration = useMemo(() => {
    if (!entry || !exit) return 0;
    const start = parseISO(entry);
    const end = parseISO(exit);
    if (isBefore(end, start)) return 0;
    return differenceInCalendarDays(end, start) + 1;
  }, [entry, exit]);

  const addDuration = (days: number) => {
    const start = parseISO(entry);
    const currentEnd = parseISO(exit);
    
    // If current end is valid (after start), add to it. Otherwise, add to start.
    const base = isBefore(currentEnd, start) ? start : currentEnd;
    
    // Subtract 1 because adding "1 week" to a 1 day trip shouldn't double count the last day if we are talking strictly additive duration? 
    // User asked: "click +1 week twice it should add two weeks". 
    // Example: Start Jan 1. Exit Jan 1. Click +7. Exit Jan 8. Click +7. Exit Jan 15.
    
    const newEnd = addDays(base, days);
    setExit(format(newEnd, 'yyyy-MM-dd'));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-black text-gray-900 mb-2">Trip Checker</h2>
        <p className="text-gray-500">Plan your future trips and ensure you stay within the 90/180 limit.</p>
      </div>
      
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row gap-8 items-start">
          
          {/* Inputs */}
          <div className="flex-1 w-full space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <DateInput 
                label="Entry Date" 
                value={entry} 
                onChange={setEntry} 
              />
              <DateInput 
                label="Exit Date" 
                value={exit} 
                min={entry}
                onChange={setExit} 
              />
            </div>

            {/* Quick Actions */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-400 tracking-wider">Extend Trip</label>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => addDuration(7)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-600 transition-colors">+1 Week</button>
                <button onClick={() => addDuration(14)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-600 transition-colors">+2 Weeks</button>
                <button onClick={() => addDuration(30)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-600 transition-colors">+30 Days</button>
                <button onClick={() => addDuration(90)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-600 transition-colors">+90 Days</button>
              </div>
            </div>
          </div>

          {/* Divider Arrow (Visual) */}
          <div className="hidden md:flex items-center h-full pt-10">
             <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
          </div>

          {/* Result Card */}
          <div className="flex-1 w-full">
            {result ? (
              <div className={`h-full p-6 rounded-xl border-2 transition-all ${result.isAllowed ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-2 rounded-lg ${result.isAllowed ? 'bg-emerald-200 text-emerald-700' : 'bg-red-200 text-red-700'}`}>
                    {result.isAllowed ? <CheckIcon /> : <AlertIcon />}
                  </div>
                  <div className="px-3 py-1 bg-white/60 rounded-full text-xs font-bold text-gray-600">
                    {duration} Days Trip
                  </div>
                </div>
                
                <h3 className={`text-xl font-bold mb-2 ${result.isAllowed ? 'text-emerald-900' : 'text-red-900'}`}>
                  {result.isAllowed ? 'Trip Allowed' : 'Limit Exceeded'}
                </h3>
                
                <div className="space-y-2">
                  <p className="text-sm">
                    Window Usage: <span className="font-bold">{result.usedOnExit}/90 days</span>
                  </p>
                  
                  {!result.isAllowed && (
                    <div className="mt-3 p-3 bg-white/50 rounded-lg">
                      <p className="text-xs font-bold text-red-800 uppercase tracking-wide mb-1">Violation</p>
                      <p className="text-sm text-red-700">
                        You hit the 90-day limit on <br/>
                        <span className="font-bold text-lg">{result.violationDate}</span>
                      </p>
                    </div>
                  )}
                  
                  {result.isAllowed && (
                    <p className="text-sm text-emerald-700 mt-2">
                      You will have <span className="font-bold">{Math.max(0, 90 - result.usedOnExit)} days remaining</span> after this trip.
                    </p>
                  )}
                </div>
              </div>
            ) : (
               <div className="h-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-200 rounded-xl text-gray-400">
                 <div className="mb-2"><CalculatorIcon /></div>
                 <span className="text-sm font-medium">Select dates to calculate</span>
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProfilesScreen = ({ store }: { store: ReturnType<typeof useSchengenStore> }) => {
  const [name, setName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-3xl font-black text-gray-900">Manage Profiles</h2>
      
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex gap-4">
          <input 
            type="text" 
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter name (e.g. Spouse, Child)..."
            className="flex-1 p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            onClick={() => { if(name) { store.addProfile(name); setName(''); } }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 rounded-lg font-bold shadow-sm transition-colors"
          >
            Add Profile
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {store.profiles.map(p => (
          <div 
            key={p.id}
            onClick={() => store.setActiveProfileId(p.id)}
            className={`
              flex justify-between items-center p-5 rounded-xl border-2 transition-all cursor-pointer bg-white group
              ${store.activeProfileId === p.id ? 'border-blue-500 shadow-md ring-1 ring-blue-100' : 'border-transparent shadow-sm hover:border-gray-200'}
            `}
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${store.activeProfileId === p.id ? 'bg-blue-600' : 'bg-gray-300'}`}>
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-gray-800 text-lg">{p.name}</div>
                <div className="text-sm text-gray-500">{p.trips.length} trips recorded</div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {store.activeProfileId === p.id && <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">ACTIVE</span>}
              
              {store.profiles.length > 1 && (
                deleteConfirmId === p.id ? (
                   <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200" onClick={e => e.stopPropagation()}>
                     <span className="text-xs text-red-600 font-bold">Sure?</span>
                     <button
                       onClick={(e) => { e.stopPropagation(); store.removeProfile(p.id); setDeleteConfirmId(null); }}
                       className="text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md text-xs font-bold shadow-sm"
                     >
                       Yes
                     </button>
                     <button
                       onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                       className="text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md text-xs font-bold"
                     >
                       No
                     </button>
                   </div>
                ) : (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(p.id); }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-all"
                    title="Delete Profile"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const InfoScreen = () => (
  <div className="max-w-3xl mx-auto space-y-8">
    <h2 className="text-3xl font-black text-gray-900">Information & Rules</h2>
    
    <div className="grid md:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-4">
          <InfoIcon />
        </div>
        <h3 className="font-bold text-xl text-gray-900 mb-2">The 90/180 Rule</h3>
        <p className="text-gray-600 leading-relaxed">
          Non-EU citizens (including Kosovo passport holders as of 2024) can stay in the Schengen area for up to <strong>90 days</strong> within any rolling <strong>180-day period</strong>.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center mb-4">
          <CheckIcon />
        </div>
        <h3 className="font-bold text-xl text-gray-900 mb-2">How it counts</h3>
        <p className="text-gray-600 leading-relaxed">
          The calculator looks back 180 days from the "Check Date" (usually today or your exit date). It sums up every day you were physically present in the zone.
        </p>
      </div>
    </div>

    <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
       <h4 className="font-bold text-blue-900 mb-2">Disclaimer</h4>
       <p className="text-sm text-blue-800 leading-relaxed">
         This application is designed to assist with travel planning but does not constitute legal advice. Border control authorities have the final say on entry. Ensure your passport is valid for at least 3 months beyond your planned date of departure from the Schengen area.
       </p>
    </div>
  </div>
);

// --- MAIN APP (Desktop Layout) ---

const App = () => {
  const store = useSchengenStore();
  const [tab, setTab] = useState<'dash' | 'calc' | 'profiles' | 'info'>('dash');

  const navItems = [
    { id: 'dash', label: 'Dashboard', icon: CalendarIcon },
    { id: 'calc', label: 'Trip Checker', icon: CalculatorIcon },
    { id: 'profiles', label: 'Profiles', icon: UserIcon },
    { id: 'info', label: 'Info & Rules', icon: InfoIcon },
  ];

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex z-20">
        <div className="p-6 border-b border-gray-100">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Schengen<span className="text-blue-600">Calc</span></h1>
          <div className="mt-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Kosovo Edition 🇽🇰</div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-all ${
                tab === item.id 
                  ? 'bg-blue-50 text-blue-700' 
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </nav>

        {/* User Quick Switcher in Sidebar */}
        <div className="p-4 border-t border-gray-100">
           <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setTab('profiles')}>
             <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
               {store.activeProfile.name.charAt(0).toUpperCase()}
             </div>
             <div className="flex-1 min-w-0">
               <div className="text-xs text-gray-400 font-bold uppercase">Active Profile</div>
               <div className="text-sm font-bold text-gray-900 truncate">{store.activeProfile.name}</div>
             </div>
             <ChevronRight />
           </div>
        </div>
      </aside>

      {/* Mobile Nav (Bottom) - Visible only on small screens */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 flex justify-around p-3 pb-6">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as any)}
            className={`flex flex-col items-center gap-1 ${tab === item.id ? 'text-blue-600' : 'text-gray-400'}`}
          >
            <item.icon />
            <span className="text-[10px] font-bold">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-gray-50/50">
        {/* Mobile Header */}
        <div className="md:hidden bg-white p-4 border-b border-gray-200 flex justify-between items-center sticky top-0 z-10">
          <h1 className="text-lg font-black text-gray-900">Schengen<span className="text-blue-600">Calc</span></h1>
          <div className="text-xs font-bold bg-gray-100 px-2 py-1 rounded text-gray-600">{store.activeProfile.name}</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 pb-24 md:pb-8">
           <div className="max-w-6xl mx-auto w-full">
              {tab === 'dash' && <DashboardScreen store={store} />}
              {tab === 'calc' && <CalculatorScreen store={store} />}
              {tab === 'profiles' && <ProfilesScreen store={store} />}
              {tab === 'info' && <InfoScreen />}
           </div>
        </div>
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
