"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { CalendarDays, MapPin, Clock, AlertTriangle, Download, Upload, CalendarIcon } from "lucide-react"

interface StayPeriod {
  id: string
  startDate: Date
  endDate: Date
  country: string
}

const STORAGE_KEY = "schengen-stay-data"

export default function SchengenTracker() {
  const [selectedDates, setSelectedDates] = useState<Date[]>([])
  const [stayPeriods, setStayPeriods] = useState<StayPeriod[]>([])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectionMode, setSelectionMode] = useState<"single" | "range">("single")
  const [rangeStart, setRangeStart] = useState<Date | null>(null)
  const [futureCalendarDate, setFutureCalendarDate] = useState(new Date())
  const [selectedFutureEntry, setSelectedFutureEntry] = useState<Date | null>(null)
  const [futureStayInfo, setFutureStayInfo] = useState<{
    entryDate: Date
    maxDays: number
    availableDays: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY)
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData)
        if (parsed.selectedDates) {
          const dates = parsed.selectedDates.map((dateStr: string) => new Date(dateStr))
          setSelectedDates(dates)
        }
        if (parsed.stayPeriods) {
          const periods = parsed.stayPeriods.map((period: any) => ({
            ...period,
            startDate: new Date(period.startDate),
            endDate: new Date(period.endDate),
          }))
          setStayPeriods(periods)
        }
      } catch (error) {
        console.error("Failed to load saved data:", error)
      }
    }
  }, [])

  const saveToLocalStorage = (dates: Date[], periods: StayPeriod[]) => {
    const dataToSave = {
      selectedDates: dates.map((date) => date.toISOString()),
      stayPeriods: periods.map((period) => ({
        ...period,
        startDate: period.startDate.toISOString(),
        endDate: period.endDate.toISOString(),
      })),
      lastUpdated: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave))
  }

  const handleDateSelection = (dates: Date[] | undefined) => {
    if (selectionMode === "single") {
      const newDates = dates || []
      setSelectedDates(newDates)
      saveToLocalStorage(newDates, stayPeriods)
    }
  }

  const handleRangeSelection = (date: Date) => {
    if (!rangeStart) {
      setRangeStart(date)
    } else {
      // Create range from rangeStart to current date
      const start = rangeStart < date ? rangeStart : date
      const end = rangeStart < date ? date : rangeStart

      const rangeDates: Date[] = []
      const currentRangeDate = new Date(start)

      while (currentRangeDate <= end) {
        rangeDates.push(new Date(currentRangeDate))
        currentRangeDate.setDate(currentRangeDate.getDate() + 1)
      }

      // Add range dates to existing selected dates (avoiding duplicates)
      const existingDateStrings = selectedDates.map((d) => d.toDateString())
      const newDates = rangeDates.filter((d) => !existingDateStrings.includes(d.toDateString()))
      const updatedDates = [...selectedDates, ...newDates]

      setSelectedDates(updatedDates)
      saveToLocalStorage(updatedDates, stayPeriods)
      setRangeStart(null)
    }
  }

  const clearAllDates = () => {
    setSelectedDates([])
    setStayPeriods([])
    setRangeStart(null)
    setSelectedFutureEntry(null)
    setFutureStayInfo(null)
    saveToLocalStorage([], [])
  }

  const calculateDaysInWindow = (referenceDate: Date = new Date()) => {
    const windowStart = new Date(referenceDate)
    windowStart.setDate(windowStart.getDate() - 180)

    let daysUsed = 0
    selectedDates.forEach((date) => {
      if (date >= windowStart && date <= referenceDate) {
        daysUsed++
      }
    })

    return daysUsed
  }

  const daysUsed = calculateDaysInWindow()
  const daysRemaining = Math.max(0, 90 - daysUsed)
  const progressPercentage = (daysUsed / 90) * 100

  const calculateNextEntryDate = () => {
    if (daysUsed <= 90) return null

    const sortedDates = [...selectedDates].sort((a, b) => a.getTime() - b.getTime())
    let runningTotal = 0

    for (let i = sortedDates.length - 1; i >= 0; i--) {
      runningTotal++
      if (runningTotal > 90) {
        const nextEntry = new Date(sortedDates[i])
        nextEntry.setDate(nextEntry.getDate() + 180)
        return nextEntry
      }
    }
    return null
  }

  const nextEntryDate = calculateNextEntryDate()

  const getStatusColor = () => {
    if (daysUsed > 90) return "destructive"
    if (daysUsed > 75) return "secondary"
    return "default"
  }

  const getStatusText = () => {
    if (daysUsed > 90) return "Limiti i kaluar"
    if (daysUsed > 75) return "Duke iu afruar limitit"
    return "Ne limitet"
  }

  const exportData = () => {
    const dataToExport = {
      selectedDates: selectedDates.map((date) => date.toISOString()),
      stayPeriods: stayPeriods.map((period) => ({
        ...period,
        startDate: period.startDate.toISOString(),
        endDate: period.endDate.toISOString(),
      })),
      exportedAt: new Date().toISOString(),
      version: "1.0",
    }

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: "application/json",
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `schengen-stays-${new Date().toISOString().split("T")[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const importedData = JSON.parse(content)

        if (importedData.selectedDates) {
          const dates = importedData.selectedDates.map((dateStr: string) => new Date(dateStr))
          setSelectedDates(dates)
        }

        if (importedData.stayPeriods) {
          const periods = importedData.stayPeriods.map((period: any) => ({
            ...period,
            startDate: new Date(period.startDate),
            endDate: new Date(period.endDate),
          }))
          setStayPeriods(periods)
        }

        setSelectedFutureEntry(null)
        setFutureStayInfo(null)

        saveToLocalStorage(
          importedData.selectedDates ? importedData.selectedDates.map((dateStr: string) => new Date(dateStr)) : [],
          importedData.stayPeriods
            ? importedData.stayPeriods.map((period: any) => ({
                ...period,
                startDate: new Date(period.startDate),
                endDate: new Date(period.endDate),
              }))
            : [],
        )

        alert("Data imported successfully!")
      } catch (error) {
        console.error("Failed to import data:", error)
        alert("Failed to import data. Please check the file format.")
      }
    }
    reader.readAsText(file)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const triggerImport = () => {
    fileInputRef.current?.click()
  }

  const calculateFutureStayInfo = (futureDate: Date) => {
    const windowStart = new Date(futureDate)
    windowStart.setDate(windowStart.getDate() - 180)

    // Count days used in the 180-day window before the future date
    let daysUsedInWindow = 0
    selectedDates.forEach((date) => {
      if (date >= windowStart && date < futureDate) {
        daysUsedInWindow++
      }
    })

    const availableDays = Math.max(0, 90 - daysUsedInWindow)
    return { daysUsedInWindow, availableDays }
  }

  const getFutureAvailableDates = () => {
    const availableDates: Date[] = []
    const startDate = new Date()
    startDate.setDate(startDate.getDate() + 1) // Start from tomorrow

    for (let i = 0; i < 365; i++) {
      // Check next 365 days
      const checkDate = new Date(startDate)
      checkDate.setDate(startDate.getDate() + i)

      const { availableDays } = calculateFutureStayInfo(checkDate)
      if (availableDays > 0) {
        availableDates.push(new Date(checkDate))
      }
    }

    return availableDates
  }

  const getMaxContinuousStay = (startDate: Date) => {
    let maxDays = 0
    const checkDate = new Date(startDate)

    for (let i = 0; i < 90; i++) {
      const { availableDays } = calculateFutureStayInfo(checkDate)
      if (availableDays > 0) {
        maxDays++
        checkDate.setDate(checkDate.getDate() + 1)
      } else {
        break
      }
    }

    return maxDays
  }

  const handleFutureDateClick = (date: Date) => {
    const { availableDays } = calculateFutureStayInfo(date)
    if (availableDays > 0) {
      const maxContinuous = getMaxContinuousStay(date)
      setSelectedFutureEntry(date)
      setFutureStayInfo({
        entryDate: date,
        maxDays: maxContinuous,
        availableDays: availableDays,
      })
    }
  }

  const futureAvailableDates = getFutureAvailableDates()
  const nextAvailableEntry = futureAvailableDates[0]
  const maxStayFromNext = nextAvailableEntry ? getMaxContinuousStay(nextAvailableEntry) : 0

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground font-sans">Njehsori I diteve ne Shengen</h1>
          <p className="text-muted-foreground font-serif">Njehso ditet 90/180 te qendrimit ne zonen Shengen</p>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-sans">Diteve te perdorura</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-sans">{daysUsed}/90</div>
              <Progress value={progressPercentage} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-sans">Ditet e mbetura</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-sans">{daysRemaining}</div>
              <Badge variant={getStatusColor()} className="mt-2">
                {getStatusText()}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-sans">Statusi i tanishëm</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm font-serif">
                {nextEntryDate ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      <span className="font-medium">Hyrja e ardhshme:</span>
                    </div>
                    <div className="text-xs">{nextEntryDate.toLocaleDateString()}</div>
                  </div>
                ) : (
                  <div className="text-green-600 font-medium">Mund te udhetoni lirisht</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-sans">Next Stay</CardTitle>
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm font-serif">
                {nextAvailableEntry ? (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Te perdorshme prej:</div>
                    <div className="text-xs font-medium">{nextAvailableEntry.toLocaleDateString()}</div>
                    <div className="text-xs text-green-600">Deri ne {maxStayFromNext} dite</div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">S'ka dite te mbetura</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Calendar Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-sans">Zgjidh ditet e qendrimit</CardTitle>
              <CardDescription className="font-serif">
                {selectionMode === "single"
                  ? "Kliko daten e qendrimit"
                  : rangeStart
                    ? "Kliko daten e fundit te qendrimit per te plotësuar zgjedhjen"
                    : "Kliko daten e fillimit te qendrimit per te filluar zgjedhjen"}
              </CardDescription>
              <div className="flex gap-2 pt-2">
                <Button
                  variant={selectionMode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectionMode("single")
                    setRangeStart(null)
                  }}
                  className="font-sans"
                >
                  Nje nga nje
                </Button>
                <Button
                  variant={selectionMode === "range" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectionMode("range")}
                  className="font-sans"
                >
                  Grup i diteve
                </Button>
                {rangeStart && (
                  <Badge variant="secondary" className="ml-2">
                    Start: {rangeStart.toLocaleDateString()}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Calendar
                mode={selectionMode === "single" ? "multiple" : "single"}
                selected={selectionMode === "single" ? selectedDates : undefined}
                onSelect={selectionMode === "single" ? handleDateSelection : undefined}
                onDayClick={selectionMode === "range" ? handleRangeSelection : undefined}
                className="rounded-md border"
                modifiers={{
                  selected: selectedDates,
                  rangeStart: rangeStart ? [rangeStart] : [],
                }}
                modifiersStyles={{
                  selected: {
                    backgroundColor: "hsl(var(--accent))",
                    color: "hsl(var(--accent-foreground))",
                  },
                  rangeStart: {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  },
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-sans">Disponimi i diteve ne te ardhmen</CardTitle>
              <CardDescription className="font-serif">
                Kliko data me te gjelber per te pare se sa dite mund te qendroni deri ne kete date hyerjeje
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Calendar
                mode="single"
                selected={selectedFutureEntry}
                month={futureCalendarDate}
                onMonthChange={setFutureCalendarDate}
                onDayClick={handleFutureDateClick}
                className="rounded-md border"
                modifiers={{
                  available: futureAvailableDates,
                  unavailable: (date) => {
                    const { availableDays } = calculateFutureStayInfo(date)
                    return availableDays === 0 && date > new Date()
                  },
                  selected: selectedFutureEntry ? [selectedFutureEntry] : [],
                }}
                modifiersStyles={{
                  available: {
                    backgroundColor: "hsl(142 76% 36%)",
                    color: "white",
                  },
                  unavailable: {
                    backgroundColor: "hsl(var(--muted))",
                    color: "hsl(var(--muted-foreground))",
                    textDecoration: "line-through",
                  },
                  selected: {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    fontWeight: "bold",
                  },
                }}
                disabled={(date) => date < new Date()}
              />
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-600 rounded"></div>
                  <span className="font-serif">Mund te hyeni (kliko per te pare se sa ditë mund te qendroni)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-muted rounded"></div>
                  <span className="font-serif">Not available (90-day limit reached)</span>
                </div>
                {futureStayInfo && (
                  <div className="mt-4 p-3 bg-accent/10 rounded-lg border">
                    <div className="font-medium text-sm font-sans mb-2">Future Stay Plan</div>
                    <div className="space-y-1 text-xs font-serif">
                      <div className="flex justify-between">
                        <span>Entry Date:</span>
                        <span className="font-medium">{futureStayInfo.entryDate.toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Max Continuous Stay:</span>
                        <span className="font-medium text-green-600">{futureStayInfo.maxDays} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Available in Window:</span>
                        <span className="font-medium">{futureStayInfo.availableDays} days</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stay Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="font-sans">Permbledhja e diteve ne Shengen</CardTitle>
            <CardDescription className="font-serif">Përmbledhja e ditëve të qendrimit në Shengen</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-serif">Totali i diteve të zgjedhura:</span>
                  <span className="font-sans font-medium">{selectedDates.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-serif">Ditet ne dritaren e tanishme:</span>
                  <span className="font-sans font-medium">{daysUsed}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-serif">Data e fillimit te dritares:</span>
                  <span className="font-sans font-medium">
                    {new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-serif">Hyrja e ardhshme e mundshme:</span>
                  <span className="font-sans font-medium">
                    {nextAvailableEntry ? nextAvailableEntry.toLocaleDateString() : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-serif">Ditet e mbetura ne dritaren e tanishme:</span>
                  <span className="font-sans font-medium">
                    {maxStayFromNext > 0 ? `${maxStayFromNext} days` : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-serif">Ditet e mbetura ne 30 ditë:</span>
                  <span className="font-sans font-medium">
                    {
                      futureAvailableDates.filter((date) => {
                        const thirtyDaysFromNow = new Date()
                        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
                        return date <= thirtyDaysFromNow
                      }).length
                    }
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={exportData} variant="outline" className="font-sans bg-transparent">
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
                <Button onClick={triggerImport} variant="outline" className="font-sans bg-transparent">
                  <Upload className="h-4 w-4 mr-2" />
                  Import
                </Button>
              </div>
              <Button onClick={clearAllDates} variant="outline" className="w-full font-sans bg-transparent">
                Clear All Dates
              </Button>
              <input ref={fileInputRef} type="file" accept=".json" onChange={importData} className="hidden" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
