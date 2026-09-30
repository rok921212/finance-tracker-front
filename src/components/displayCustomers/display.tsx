import React, { useState, ChangeEvent, useMemo, useRef, useEffect, useCallback } from "react";
import { Team, Booking } from "../../api";
import { motion, AnimatePresence } from "framer-motion";
import { formatDisplayDateCompact, parseDate } from "../../utils/date";

// html2canvas is only needed when exporting, so it is downloaded on first use
const loadHtml2canvas = () => import("html2canvas").then((m) => m.default);

// QR images stay in the browser: shrunk to 200x200 (their largest display size) as a data URL,
// so nothing is uploaded or stored and the export canvas has no cross-origin images
const toQrDataUrl = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  // Center-crop to a square, like the previous c_fill transformation
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 200, 200);
  bitmap.close();
  return canvas.toDataURL("image/png");
};

interface DisplayBookingsProps {
  teams: Team[];
  refreshTeams?: () => Promise<void>;
  onUpdateBooking: (teamName: string, bookingIndex: number, updatedBooking: Booking) => Promise<void>;
  onDeleteBooking: (teamName: string, bookingIndex: number) => Promise<void>;
  onDeleteTeam: (teamName: string) => Promise<void>;
}

interface EditingBooking {
  teamName: string;
  index: number;
}

interface BookingForm extends Booking {}

interface PreprocessedBooking extends Booking {
  _parsedDate: Date;
  _dateLower: string;
  _casterLower: string;
}

interface PreprocessedTeam extends Omit<Team, 'bookings'> {
  bookings: PreprocessedBooking[];
}

interface PdfExportState {
  teamName: string;
  startDate: string;
  endDate: string;
}

type SortOption = "default" | "entryFeeHigh" | "entryFeeLow" | "dateNewest" | "dateOldest";

const DisplayBookings: React.FC<DisplayBookingsProps> = ({
  teams,
  onUpdateBooking,
  onDeleteBooking,
  onDeleteTeam,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [editingBooking, setEditingBooking] = useState<EditingBooking | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("default");
  const [filterDate, setFilterDate] = useState<string>("");
  const [pdfExport, setPdfExport] = useState<PdfExportState | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [bookingForm, setBookingForm] = useState<BookingForm>({
    date: "",
    time: "",
    server: "",
    entryFee: 0,
    winning: 0,
    discription: "",
    caster: "",
    casterCost: 0,
    production: "",
    productionCost: 0,
    paid: false,
  });
  const [qr1, setQr1] = useState<string | null>(null);
  const [qr2, setQr2] = useState<string | null>(null);
  const [qr3, setQr3] = useState<string | null>(null);
  const [qr4, setQr4] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [massExport, setMassExport] = useState(false);
  const massPrintRef = useRef<HTMLDivElement>(null);

  // Debounce search term to improve performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Preprocess teams once: parse all booking dates
  const teamsWithParsedDates = useMemo(() => {
    return teams.map(team => ({
      ...team,
      _searchString: [
        team.teamName?.toLowerCase() || "",
        ...team.bookings.flatMap(b => [
          b.date?.toLowerCase() || "",
          b.time?.toLowerCase() || "",
          b.server?.toLowerCase() || "",
          b.discription?.toLowerCase() || "",
          b.caster?.toLowerCase() || "",
          b.production?.toLowerCase() || "",
        ])
      ].join(" "),
      bookings: team.bookings.map(b => ({
        ...b,
        _parsedDate: parseDate(b.date), // store parsed date once
        _dateLower: b.date?.toLowerCase() || "",
        _casterLower: b.caster?.toLowerCase() || "",
      })),
    }));
  }, [teams]);

  // Get today's date string for comparison
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getTodayString = (): string => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Compute filtered teams AND profit stats in one go
  const { filteredTeams, profitStats } = useMemo(() => {
    const lowerSearch = debouncedSearch.toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    let totalEntryFee = 0;
    let totalWinning = 0;
    let totalBookings = 0;
    let todayProfit = 0;
    let yesterdayProfit = 0;
    let weeklyProfit = 0;
    let monthlyProfit = 0;

    const filtered: PreprocessedTeam[] = [];

    teamsWithParsedDates.forEach(team => {
      // Instant search using precomputed string
      const matchesSearch = team._searchString.includes(lowerSearch);

      const filteredBookings = team.bookings.filter(b => {
        // Filter by date input if provided
        const matchesDate = filterDate
          ? b._parsedDate.toDateString() === parseDate(filterDate).toDateString()
          : true;

        return matchesDate && (matchesSearch || lowerSearch === "");
      });

      // Calculate profit stats here
      filteredBookings.forEach(b => {
        const entryFeeToCount = b.paid ? 0 : (b.entryFee || 0);
        const profit = entryFeeToCount - (b.winning || 0);

        totalEntryFee += entryFeeToCount;
        totalWinning += b.winning || 0;
        totalBookings++;

        const bDate = b._parsedDate;
        if (bDate.toDateString() === today.toDateString()) todayProfit += profit;
        if (bDate.toDateString() === yesterday.toDateString()) yesterdayProfit += profit;
        if (bDate >= weekAgo) weeklyProfit += profit;
        if (bDate >= monthAgo) monthlyProfit += profit;
      });

      if (filteredBookings.length > 0 || matchesSearch) {
        filtered.push({ ...team, bookings: filteredBookings });
      }
    });

    // Sorting
    const sorted = filtered.sort((a, b) => {
      switch (sortOption) {
        case "entryFeeHigh": {
          const totalA = a.bookings.reduce((sum, b) => sum + (b.entryFee || 0), 0);
          const totalB = b.bookings.reduce((sum, b) => sum + (b.entryFee || 0), 0);
          return totalB - totalA;
        }
        case "entryFeeLow": {
          const totalA = a.bookings.reduce((sum, b) => sum + (b.entryFee || 0), 0);
          const totalB = b.bookings.reduce((sum, b) => sum + (b.entryFee || 0), 0);
          return totalA - totalB;
        }
        case "dateNewest": {
          const dateA = a.bookings.length > 0 ? a.bookings[a.bookings.length - 1]._parsedDate.getTime() : 0;
          const dateB = b.bookings.length > 0 ? b.bookings[b.bookings.length - 1]._parsedDate.getTime() : 0;
          return dateB - dateA;
        }
        case "dateOldest": {
          const dateA = a.bookings.length > 0 ? a.bookings[0]._parsedDate.getTime() : Infinity;
          const dateB = b.bookings.length > 0 ? b.bookings[0]._parsedDate.getTime() : Infinity;
          return dateA - dateB;
        }
        default:
          return 0;
      }
    });

    return {
      filteredTeams: sorted,
      profitStats: {
        todayProfit,
        yesterdayProfit,
        weeklyProfit,
        monthlyProfit,
        totalEntryFee,
        totalWinning,
        totalProfit: totalEntryFee - totalWinning,
        totalBookings,
      },
    };
  }, [teamsWithParsedDates, debouncedSearch, filterDate, sortOption]);

  // Handle mass export
  const handleMassExport = useCallback(async (): Promise<void> => {
    if (!massPrintRef.current) return;

    try {
      const html2canvas = await loadHtml2canvas();
      const canvas = await html2canvas(massPrintRef.current, {
        background: '#ffffff',
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `mass_export_${searchTerm}_${new Date().toISOString().split('T')[0]}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
      setMassExport(false);
    } catch (error) {
      console.error('Error generating mass export:', error);
    }
  }, [searchTerm, setMassExport]);

  // Trigger mass export when massExport is set
  useEffect(() => {
    if (massExport) {
      // Use timeout to ensure the div is rendered and images loaded
      setTimeout(() => {
        handleMassExport();
      }, 1000);
    }
  }, [massExport, handleMassExport]);

  if (!teams) return <p>Loading teams...</p>;

  const handleEditBookingClick = (teamName: string, booking: Booking, index: number): void => {
    setEditingBooking({ teamName, index });
    setBookingForm({ ...booking });
  };

  const handleCancelEdit = (): void => {
    setEditingBooking(null);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = e.target;
    setBookingForm((prev) => ({
      ...prev,
      [name]: ["entryFee", "winning", "casterCost", "productionCost"].includes(name)
        ? Number(value)
        : value,
    }));
  };

  const handleSaveBooking = (): void => {
    if (!editingBooking) return;
    onUpdateBooking(editingBooking.teamName, editingBooking.index, bookingForm);
    setEditingBooking(null);
  };

  const handleDeleteBooking = (teamName: string, index: number): void => {
    if (window.confirm(`Are you sure you want to delete booking #${index + 1} from team "${teamName}"?`)) {
      onDeleteBooking(teamName, index);
    }
  };

  // Filter bookings by date range for PDF export
  const filterBookingsByDateRange = (bookings: Booking[], startDate: string, endDate: string): Booking[] => {
    if (!startDate && !endDate) return bookings;
    
    return bookings.filter((b) => {
      if (!b.date) return false;
      const bookingDate = parseDate(b.date);
      
      if (startDate && endDate) {
        const start = parseDate(startDate);
        const end = parseDate(endDate);
        return bookingDate >= start && bookingDate <= end;
      } else if (startDate) {
        const start = parseDate(startDate);
        return bookingDate >= start;
      } else if (endDate) {
        const end = parseDate(endDate);
        return bookingDate <= end;
      }
      return true;
    });
  };

  // Handle image export for a specific team
  const handleExportImage = async (teamName: string): Promise<void> => {
    if (!printRef.current) return;
    
    try {
      const html2canvas = await loadHtml2canvas();
      const canvas = await html2canvas(printRef.current, {
        background: '#ffffff',
        useCORS: true,
      } as unknown as Partial<Parameters<typeof html2canvas>[1]>);
      
      const link = document.createElement('a');
      link.download = `${teamName}_report_${new Date().toISOString().split('T')[0]}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
      
      setPdfExport(null);
    } catch (error) {
      console.error('Error generating image:', error);
    }
  };

  // Handle PDF export button click - opens modal
  const handleExportPdfClick = (teamName: string): void => {
    const team = teams.find(t => t.teamName === teamName);
    if (!team) return;

    // Get the date range from existing bookings
    const dates = team.bookings
      .map(b => parseDate(b.date))
      .filter(d => d.getTime() > 0)
      .sort((a, b) => a.getTime() - b.getTime());

    const minDate = dates.length > 0 ? dates[0] : new Date();
    const maxDate = dates.length > 0 ? dates[dates.length - 1] : new Date();

    const formatDateForInput = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    setPdfExport({
      teamName,
      startDate: formatDateForInput(minDate),
      endDate: formatDateForInput(maxDate),
    });
  };


  // Get filtered bookings for PDF export
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // const getPdfBookings = (team: Team): Booking[] => {
  //   if (!pdfExport || pdfExport.teamName !== team.teamName) {
  //     return team.bookings;
  //   }
  //   return filterBookingsByDateRange(team.bookings, pdfExport.startDate, pdfExport.endDate);
  // };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black px-4 md:px-8 py-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-7xl mx-auto"
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center mb-4 md:mb-0">
            <h2 className="text-3xl md:text-4xl font-bold text-white flex items-center">
              <span className="w-3 h-12 bg-gradient-to-b from-red-500 to-red-700 mr-4 rounded-full print:hidden"></span>
              Finance Dashboard
            </h2>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowQrModal(true)}
              className="ml-4 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-300"
            >
              Upload QR Codes
            </motion.button>
          </div>
          <div className="text-gray-400 text-sm">
            Last updated: {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        {/* Profit Statistics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-green-600/20 to-green-700/20 backdrop-blur-md rounded-xl p-4 md:p-6 border border-green-500/30"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-400 text-xs md:text-sm uppercase tracking-wider">Today's Profit</p>
                <p className="text-xl md:text-2xl font-bold text-white mt-1">Rs {Math.round(profitStats.todayProfit)}</p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-green-500/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
                </svg>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-blue-600/20 to-blue-700/20 backdrop-blur-md rounded-xl p-4 md:p-6 border border-blue-500/30"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-400 text-xs md:text-sm uppercase tracking-wider">Weekly Profit</p>
                <p className="text-xl md:text-2xl font-bold text-white mt-1">Rs {Math.round(profitStats.weeklyProfit)}</p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                </svg>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-purple-600/20 to-purple-700/20 backdrop-blur-md rounded-xl p-4 md:p-6 border border-purple-500/30"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-400 text-xs md:text-sm uppercase tracking-wider">Monthly Profit</p>
                <p className="text-xl md:text-2xl font-bold text-white mt-1">Rs {Math.round(profitStats.monthlyProfit)}</p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-purple-500/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-gradient-to-br from-red-600/20 to-red-700/20 backdrop-blur-md rounded-xl p-4 md:p-6 border border-red-500/30"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-400 text-xs md:text-sm uppercase tracking-wider">Total Profit</p>
                <p className="text-xl md:text-2xl font-bold text-white mt-1">Rs {Math.round(profitStats.totalProfit)}</p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Summary Bar */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className="bg-gradient-to-r from-gray-800/50 to-gray-900/50 backdrop-blur-md rounded-xl p-4 md:p-6 mb-8 border border-gray-700/50"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-6">
              <div className="text-center">
                <span className="text-gray-400 text-xs uppercase tracking-wider">Total Entry Fee</span>
                <p className="text-lg md:text-xl font-bold text-white">Rs {Math.round(profitStats.totalEntryFee)}</p>
              </div>
              <div className="text-center">
                <span className="text-gray-400 text-xs uppercase tracking-wider">Total Winning</span>
                <p className="text-lg md:text-xl font-bold text-white">Rs {Math.round(profitStats.totalWinning)}</p>
              </div>
              <div className="text-center">
                <span className="text-gray-400 text-xs uppercase tracking-wider">Total Bookings</span>
                <p className="text-lg md:text-xl font-bold text-white">{profitStats.totalBookings}</p>
              </div>
            </div>
            <div className={`px-4 py-2 rounded-lg ${profitStats.totalProfit >= 0 ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <span className="text-gray-400 text-xs uppercase tracking-wider">Net Balance</span>
              <p className={`text-xl font-bold ${profitStats.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                Rs {Math.round(profitStats.totalProfit)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Search and Filter Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-white/5 backdrop-blur-md rounded-xl p-4 md:p-6 mb-8 border border-gray-700/50"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search Input */}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Search</label>
              <input
                type="text"
                placeholder="Search by team name, date, or booked by..."
                value={searchTerm}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
              />
            </div>

            {/* Date Filter */}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Filter by Date</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFilterDate(e.target.value)}
                  className="flex-1 bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300"
                />
                {filterDate && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setFilterDate("")}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Clear
                  </motion.button>
                )}
              </div>
            </div>

            {/* Sort Options */}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Sort Teams By</label>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300"
              >
                <option value="default">Default Order</option>
                <option value="entryFeeHigh">Entry Fee (Highest First)</option>
                <option value="entryFeeLow">Entry Fee (Lowest First)</option>
                <option value="dateNewest">Date (Newest First)</option>
                <option value="dateOldest">Date (Oldest First)</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* Mass Export Button */}
        {filteredTeams.length > 0 && searchTerm && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setMassExport(true)}
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Mass Export
          </motion.button>
        )}

        {/* Teams List */}
        <AnimatePresence>
          {filteredTeams.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <div className="w-20 h-20 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
              <p className="text-gray-400 text-xl">No teams found.</p>
              <p className="text-gray-500 text-sm mt-2">Try adjusting your search or filter criteria.</p>
            </motion.div>
          ) : (
            filteredTeams.map((team, teamIndex) => {
              const totalEntryFee = team.bookings.reduce((sum, b) => sum + (b.paid ? 0 : (b.entryFee || 0)), 0);
               const totalWinning = team.bookings.reduce((sum, b) => sum + (b.winning || 0), 0);
               const teamProfit = totalEntryFee - totalWinning;
              
              // Get PDF bookings if this team is being exported
  // const pdfBookings = pdfExport?.teamName === team.teamName 
  //   ? getPdfBookings(team) 
  //   : team.bookings;

              return (
                <motion.div
                  key={team._id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * teamIndex }}
                  exit={{ opacity: 0, y: -30 }}
                  className="mb-8"
                >
                  {/* PDF Export Modal */}
                  <AnimatePresence>
                    {pdfExport && pdfExport.teamName === team.teamName && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center print:hidden"
                        onClick={() => setPdfExport(null)}
                      >
                        <motion.div
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.9, opacity: 0 }}
                          className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            Export Image - {team.teamName}
                          </h3>
                          <p className="text-gray-400 text-sm mb-4">Select date range for the report:</p>
                          <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">Start Date</label>
                              <input
                                type="date"
                                value={pdfExport.startDate}
                                onChange={(e) => setPdfExport({ ...pdfExport, startDate: e.target.value })}
                                className="w-full bg-black/50 border border-gray-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-sm mb-2">End Date</label>
                              <input
                                type="date"
                                value={pdfExport.endDate}
                                onChange={(e) => setPdfExport({ ...pdfExport, endDate: e.target.value })}
                                className="w-full bg-black/50 border border-gray-600 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>
                          <div className="flex gap-3">
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleExportImage(team.teamName)}
                              className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-medium hover:from-blue-700 hover:to-blue-800 transition-all"
                            >
                              Export as Image
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => setPdfExport(null)}
                              className="px-4 py-3 bg-gray-700 text-white rounded-lg font-medium hover:bg-gray-600 transition-all"
                            >
                              Cancel
                            </motion.button>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  {/* Hidden container for image export */}
                  {pdfExport && pdfExport.teamName === team.teamName && (
                    <div 
                      ref={printRef}
                      className="fixed left-[-9999px] top-0 bg-white p-6"
                      style={{ width: '800px' }}
                    >
                      <h2 className="text-2xl font-bold text-gray-900 mb-2">{team.teamName}</h2>
                      <p className="text-gray-600 mb-4">
                        Date Range: {pdfExport.startDate} to {pdfExport.endDate}
                      </p>
                      <table className="w-full border-collapse">
                         <thead>
                           <tr className="bg-gray-100">
                             <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">Date</th>
                             <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">Time</th>
                             <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">Server</th>
                             <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-gray-700">Entry Fee</th>
                             <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-gray-700">Winning</th>
                             <th className="border border-gray-300 px-4 py-2 text-center font-semibold text-gray-700">Status</th>
                           </tr>
                         </thead>
                         <tbody>
                           {filterBookingsByDateRange(team.bookings, pdfExport.startDate, pdfExport.endDate).map((b, index) => (
                             <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                               <td className="border border-gray-300 px-4 py-2 text-gray-900">{formatDisplayDateCompact(b.date)}</td>
                               <td className="border border-gray-300 px-4 py-2 text-gray-900">{b.time}</td>
                               <td className="border border-gray-300 px-4 py-2 text-gray-900">{b.server}</td>
                               <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">Rs {Math.round(b.entryFee || 0)}</td>
                               <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">Rs {Math.round(b.winning || 0)}</td>
                               <td className="border border-gray-300 px-4 py-2 text-center text-gray-900">
                                 <span className={`px-2 py-1 rounded text-xs font-medium ${b.paid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                   {b.paid ? 'Paid' : 'Unpaid'}
                                 </span>
                               </td>
                             </tr>
                           ))}
                         </tbody>
                         <tfoot>
                           <tr className="bg-gray-100 font-bold">
                             <td colSpan={3} className="border border-gray-300 px-4 py-2 text-right text-gray-900">Totals:</td>
                             <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                               Rs {Math.round(filterBookingsByDateRange(team.bookings, pdfExport.startDate, pdfExport.endDate).reduce((sum, b) => sum + (b.paid ? 0 : (b.entryFee || 0)), 0))}
                             </td>
                             <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                               Rs {Math.round(filterBookingsByDateRange(team.bookings, pdfExport.startDate, pdfExport.endDate).reduce((sum, b) => sum + (b.winning || 0), 0))}
                             </td>
                             <td className="border border-gray-300 px-4 py-2"></td>
                           </tr>
                           <tr className="bg-gray-200 font-bold">
                             <td colSpan={5} className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                               {(() => {
                                 const net = Math.round(filterBookingsByDateRange(team.bookings, pdfExport.startDate, pdfExport.endDate).reduce((sum, b) => sum + (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0), 0));
                                 return net < 0 ? "Winning Pending" : "Entry Pending";
                               })()}
                             </td>
                             <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                               Rs {(() => {
                                 const net = Math.round(filterBookingsByDateRange(team.bookings, pdfExport.startDate, pdfExport.endDate).reduce((sum, b) => sum + (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0), 0));
                                 return Math.abs(net);
                               })()}
                             </td>
                           </tr>
                         </tfoot>
                       </table>
                       {(qr1 || qr2 || qr3 || qr4) && (
                         <div style={{ marginTop: '20px', display: 'flex', gap: '0', justifyContent: 'center' }}>
                           {qr1 && <img src={qr1} alt="QR1" style={{ width: '200px', height: '200px' }} />}
                           {qr2 && <img src={qr2} alt="QR2" style={{ width: '200px', height: '200px' }} />}
                           {qr3 && <img src={qr3} alt="QR3" style={{ width: '200px', height: '200px' }} />}
                           {qr4 && <img src={qr4} alt="QR4" style={{ width: '200px', height: '200px' }} />}
                         </div>
                       )}
                    </div>
                  )}
                  
                  <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
                    {/* Team Header */}
                    <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 px-6 py-4 border-b border-gray-700/50">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-700 rounded-xl flex items-center justify-center print:hidden">
                            <span className="text-white font-bold text-lg">{team.teamName.charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <h3 className="text-2xl font-bold text-white">{team.teamName}</h3>
                            <p className="text-gray-400 text-sm">{team.bookings.length} booking{team.bookings.length !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-gray-400 text-xs uppercase tracking-wider">Team Profit</p>
                            <p className={`text-xl font-bold ${teamProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              Rs {Math.round(teamProfit)}
                            </p>
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleExportPdfClick(team.teamName)}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-300 print:hidden"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
                            </svg>
                            Export Image
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => onDeleteTeam(team.teamName)}
                            className="px-4 py-2 bg-red-600/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-600 hover:text-white transition-all duration-300 print:hidden"
                          >
                            Delete
                          </motion.button>
                        </div>
                      </div>
                    </div>

                    {/* Bookings Table */}
                    {team.bookings.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-gray-500">No bookings available for this team.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-gray-800/50 text-gray-400 text-sm uppercase tracking-wider">
                               <th className="px-4 py-3 text-left">Date</th>
                               <th className="px-4 py-3 text-left">Time</th>
                               <th className="px-4 py-3 text-left">Server</th>
                               <th className="px-4 py-3 text-right">Entry Fee</th>
                               <th className="px-4 py-3 text-right">Winning</th>
                               <th className="px-4 py-3 text-right print:hidden">Profit</th>
                               <th className="px-4 py-3 text-left print:hidden">Description</th>
                               <th className="px-4 py-3 text-left print:hidden">Booked By</th>
                               <th className="px-4 py-3 text-center print:hidden">Actions</th>
                               <th className="px-4 py-3 text-center print:hidden">Paid/Unpaid</th>
                             </tr>
                          </thead>
                          <tbody>
                            {team.bookings.map((b, index) => {
                              if (editingBooking && editingBooking.teamName === team.teamName && editingBooking.index === index) {
                                return (
                                  <motion.tr
                                    key={index}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="bg-yellow-500/10 border-b border-gray-700/50"
                                  >
                                    <td className="px-4 py-3">
                                      <input type="date" name="date" value={bookingForm.date} onChange={handleChange} className="bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500" />
                                    </td>
                                    <td className="px-4 py-3">
                                      <input type="text" name="time" value={bookingForm.time} onChange={handleChange} className="bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500" />
                                    </td>
                                    <td className="px-4 py-3">
                                      <input type="text" name="server" value={bookingForm.server} onChange={handleChange} className="bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500" />
                                    </td>
                                    <td className="px-4 py-3">
                                      <input type="number" name="entryFee" value={bookingForm.entryFee} onChange={handleChange} className="w-24 bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500 text-right" min="0" />
                                    </td>
                                    <td className="px-4 py-3">
                                      <input type="number" name="winning" value={bookingForm.winning} onChange={handleChange} className="w-24 bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500 text-right" min="0" />
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-400 print:hidden">-</td>
                                    <td className="px-4 py-3 print:hidden">
                                      <input type="text" name="discription" value={bookingForm.discription} onChange={handleChange} className="bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500" />
                                    </td>
                                    <td className="px-4 py-3 print:hidden">
                                      <input type="text" name="caster" value={bookingForm.caster} onChange={handleChange} className="bg-black/50 border border-gray-600 text-white px-3 py-2 rounded focus:outline-none focus:border-red-500" />
                                    </td>
                                     <td className="px-4 py-3 print:hidden">
                                       <div className="flex justify-center gap-2">
                                         <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleSaveBooking} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors">Save</motion.button>
                                         <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleCancelEdit} className="px-3 py-1 bg-gray-600 text-white rounded text-sm font-medium hover:bg-gray-700 transition-colors">Cancel</motion.button>
                                       </div>
                                     </td>
                                     <td className="px-4 py-3 text-center print:hidden">
                                       <label className="relative inline-flex items-center cursor-pointer">
                                         <input 
                                           type="checkbox" 
                                           name="paid"
                                           checked={bookingForm.paid || false} 
                                           onChange={(e) => setBookingForm(prev => ({ ...prev, paid: e.target.checked }))} 
                                           className="sr-only peer"
                                         />
                                         <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-600"></div>
                                         <span className={`ms-2 text-xs font-medium ${bookingForm.paid ? 'text-green-400' : 'text-gray-400'}`}>
                                           {bookingForm.paid ? 'Paid' : 'Unpaid'}
                                         </span>
                                       </label>
                                     </td>
                                   </motion.tr>
                                );
                              }

                              const bookingProfit = (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0);

                              return (
                                <motion.tr
                                  key={index}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: index * 0.03 }}
                                  className={`border-b border-gray-700/30 hover:bg-white/5 transition-colors ${index % 2 === 0 ? 'bg-black/20' : 'bg-transparent'}`}
                                >
                                  <td className="px-4 py-3 text-white">{formatDisplayDateCompact(b.date)}</td>
                                  <td className="px-4 py-3 text-white">{b.time}</td>
                                  <td className="px-4 py-3 text-white">{b.server}</td>
                                  <td className="px-4 py-3 text-right text-white font-medium">Rs {Math.round(b.entryFee)}</td>
                                  <td className="px-4 py-3 text-right text-white font-medium">Rs {Math.round(b.winning)}</td>
                                  <td className={`px-4 py-3 text-right font-bold print:hidden ${bookingProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    Rs {Math.round(bookingProfit)}
                                  </td>
                                  <td className="px-4 py-3 text-gray-300 print:hidden">{b.discription}</td>
                                  <td className="px-4 py-3 text-gray-300 print:hidden">{b.caster}</td>
                                  <td className="px-4 py-3 print:hidden">
                                     <div className="flex justify-center gap-2">
                                       <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => handleEditBookingClick(team.teamName, b, index)} className="px-3 py-1 bg-blue-600/20 border border-blue-500/50 text-blue-400 rounded text-sm font-medium hover:bg-blue-600 hover:text-white transition-all">Edit</motion.button>
                                       <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => handleDeleteBooking(team.teamName, index)} className="px-3 py-1 bg-red-600/20 border border-red-500/50 text-red-400 rounded text-sm font-medium hover:bg-red-600 hover:text-white transition-all">Delete</motion.button>
                                     </div>
                                   </td>
                                   <td className="px-4 py-3 text-center print:hidden">
                                     <label className="relative inline-flex items-center cursor-pointer">
                                       <input 
                                         type="checkbox" 
                                         checked={b.paid || false} 
                                         onChange={(e) => {
                                           const updatedBooking = { ...b, paid: e.target.checked };
                                           onUpdateBooking(team.teamName, index, updatedBooking);
                                         }}
                                         className="sr-only peer"
                                       />
                                       <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-600"></div>
                                       <span className={`ms-2 text-xs font-medium ${b.paid ? 'text-green-400' : 'text-gray-400'}`}>
                                         {b.paid ? 'Paid' : 'Unpaid'}
                                       </span>
                                     </label>
                                   </td>
                                 </motion.tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                             <tr className="bg-gradient-to-r from-gray-800/50 to-gray-900/50 font-bold">
                               <td colSpan={3} className="px-4 py-3 text-right text-white">Team Totals:</td>
                               <td className="px-4 py-3 text-right text-white">Rs {Math.round(totalEntryFee)}</td>
                               <td className="px-4 py-3 text-right text-white">Rs {Math.round(totalWinning)}</td>
                               <td className={`px-4 py-3 text-right print:hidden ${teamProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>Rs {Math.round(teamProfit)}</td>
                               <td colSpan={4} className="print:hidden"></td>
                             </tr>
                           </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>

        {/* Mass Export Hidden Div */}
        {massExport && (
          <div
            ref={massPrintRef}
            className="fixed left-[-9999px] top-0 bg-white p-6"
            style={{ width: '1200px' }}
          >
            <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">Mass Export - {searchTerm}</h1>

            {filteredTeams.map(team => (
              <div key={team.teamName} className="mb-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">{team.teamName}</h2>
                <table className="w-full border-collapse mb-4">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">Date</th>
                      <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">Time</th>
                      <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">Server</th>
                      <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-gray-700">Entry Fee</th>
                      <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-gray-700">Winning</th>
                      <th className="border border-gray-300 px-4 py-2 text-center font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.bookings.map((b, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-300 px-4 py-2 text-gray-900">{formatDisplayDateCompact(b.date)}</td>
                        <td className="border border-gray-300 px-4 py-2 text-gray-900">{b.time}</td>
                        <td className="border border-gray-300 px-4 py-2 text-gray-900">{b.server}</td>
                        <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">Rs {Math.round(b.entryFee || 0)}</td>
                        <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">Rs {Math.round(b.winning || 0)}</td>
                        <td className="border border-gray-300 px-4 py-2 text-center text-gray-900">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${b.paid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {b.paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-200 font-bold">
                      <td colSpan={3} className="border border-gray-300 px-4 py-2 text-right text-gray-900">{team.teamName} Totals:</td>
                      <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                        Rs {Math.round(team.bookings.reduce((s, b) => s + (b.paid ? 0 : (b.entryFee || 0)), 0))}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                        Rs {Math.round(team.bookings.reduce((s, b) => s + (b.winning || 0), 0))}
                      </td>
                      <td className="border border-gray-300 px-4 py-2"></td>
                    </tr>
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={5} className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                        {(() => {
                          const net = Math.round(team.bookings.reduce((s, b) => s + (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0), 0));
                          return net < 0 ? "Winning Pending" : "Entry Pending";
                        })()}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                        Rs {(() => {
                          const net = Math.round(team.bookings.reduce((s, b) => s + (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0), 0));
                          return Math.abs(net);
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}

            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Overall Totals</h2>
              <table className="w-full border-collapse">
                <tbody>
                  <tr className="bg-gray-100 font-bold">
                    <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">Total Entry Fee:</td>
                    <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                      Rs {Math.round(filteredTeams.reduce((sum, team) => sum + team.bookings.reduce((s, b) => s + (b.paid ? 0 : (b.entryFee || 0)), 0), 0))}
                    </td>
                  </tr>
                  <tr className="bg-gray-100 font-bold">
                    <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">Total Winning:</td>
                    <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                      Rs {Math.round(filteredTeams.reduce((sum, team) => sum + team.bookings.reduce((s, b) => s + (b.winning || 0), 0), 0))}
                    </td>
                  </tr>
                  <tr className="bg-gray-100 font-bold">
                    <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                      {(() => {
                        const net = Math.round(filteredTeams.reduce((sum, team) => sum + team.bookings.reduce((s, b) => s + (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0), 0), 0));
                        return net < 0 ? "Winning Pending:" : "Entry Pending Remaining:";
                      })()}
                    </td>
                    <td className="border border-gray-300 px-4 py-2 text-right text-gray-900">
                      Rs {(() => {
                        const net = Math.round(filteredTeams.reduce((sum, team) => sum + team.bookings.reduce((s, b) => s + (b.paid ? 0 : (b.entryFee || 0)) - (b.winning || 0), 0), 0));
                        return Math.abs(net);
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {(qr1 || qr2 || qr3 || qr4) && (
              <div style={{ marginTop: '20px', display: 'flex', gap: '0', justifyContent: 'center' }}>
                {qr1 && <img src={qr1} alt="QR1" style={{ width: '200px', height: '200px' }} />}
                {qr2 && <img src={qr2} alt="QR2" style={{ width: '200px', height: '200px' }} />}
                {qr3 && <img src={qr3} alt="QR3" style={{ width: '200px', height: '200px' }} />}
                {qr4 && <img src={qr4} alt="QR4" style={{ width: '200px', height: '200px' }} />}
              </div>
            )}
          </div>
        )}

        {/* QR Upload Modal */}
        {showQrModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
              <h3 className="text-white text-lg font-semibold mb-4">Upload QR Codes</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">QR1</label>
                  <label className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-300 cursor-pointer inline-block text-center">
                    Upload QR1
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files[0]) {
                          const url = await toQrDataUrl(e.target.files[0]);
                          setQr1(url);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {qr1 && <img src={qr1} alt="QR1" className="mt-2 w-20 h-20" />}
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">QR2</label>
                  <label className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-300 cursor-pointer inline-block text-center">
                    Upload QR2
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files[0]) {
                          const url = await toQrDataUrl(e.target.files[0]);
                          setQr2(url);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {qr2 && <img src={qr2} alt="QR2" className="mt-2 w-20 h-20" />}
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">QR3</label>
                  <label className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-300 cursor-pointer inline-block text-center">
                    Upload QR3
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files[0]) {
                          const url = await toQrDataUrl(e.target.files[0]);
                          setQr3(url);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {qr3 && <img src={qr3} alt="QR3" className="mt-2 w-20 h-20" />}
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">QR4</label>
                  <label className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-300 cursor-pointer inline-block text-center">
                    Upload QR4
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files[0]) {
                          const url = await toQrDataUrl(e.target.files[0]);
                          setQr4(url);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {qr4 && <img src={qr4} alt="QR4" className="mt-2 w-20 h-20" />}
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={() => setShowQrModal(false)} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">Close</button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default DisplayBookings;
