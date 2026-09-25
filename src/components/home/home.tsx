import React, { useEffect, useState, ChangeEvent, FormEvent } from "react";
import Display from "../displayCustomers/display.tsx";
import {
  Team,
  Booking,
  fetchTeams,
  createTeam,
  addBooking,
  updateBooking,
  deleteBooking,
  deleteTeam,
  updateCachedTeams,
} from "../../api";
import { peekCached, useDropTick } from "../../lib/cache";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { Link } from "react-router-dom";

const TeamSelector: React.FC = () => {
  // Start from the cached copy (instant render), then revalidate
  const [teams, setTeams] = useState<Team[]>(() => peekCached<Team[]>("/bookingData") || []);
  // Local delta updates also refresh the cached copy, so returning to this page is instant
  useEffect(() => {
    updateCachedTeams(() => teams);
  }, [teams]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [message, setMessage] = useState<string>("");
  const [newTeamName, setNewTeamName] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [booking, setBooking] = useState<Booking>({
    customerName: "",
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

  const { user, logout } = useAuth();

  // Fetch teams
  const loadTeams = async (): Promise<void> => {
    try {
      const data = await fetchTeams();
      setTeams(data);
    } catch {
      setMessage("Failed to load teams. Please login again.");
    }
  };

  // Loaded from the cache; refetched only when the server pushes a change made elsewhere
  const teamsChanged = useDropTick("/bookingData");
  useEffect(() => {
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsChanged]);

  const handleCheckboxChange = (teamName: string): void => {
    setSelectedTeams((prev) =>
      prev.includes(teamName)
        ? prev.filter((t) => t !== teamName)
        : [...prev, teamName]
    );
  };

  const handleUpdateBooking = async (
    teamName: string,
    bookingIndex: number,
    updatedBooking: Booking
  ): Promise<void> => {
    try {
      // Delta update: send only the fields that actually changed
      const current = teams.find((t) => t.teamName === teamName)?.bookings[bookingIndex];
      const changes: Partial<Booking> = {};
      (Object.keys(updatedBooking) as (keyof Booking)[]).forEach((k) => {
        // Skip ids and UI-only fields (e.g. _parsedDate) added by the table
        if (!String(k).startsWith("_") && (!current || current[k] !== updatedBooking[k])) {
          (changes as Record<string, unknown>)[k] = updatedBooking[k];
        }
      });
      if (Object.keys(changes).length === 0) {
        setMessage("No changes to save");
        return;
      }
      const stored = await updateBooking(teamName, bookingIndex, changes);
      setTeams((prev) =>
        prev.map((t) =>
          t.teamName === teamName
            ? { ...t, bookings: t.bookings.map((b, i) => (i === bookingIndex ? { ...b, ...stored } : b)) }
            : t
        )
      );
      setMessage("Booking updated successfully");
    } catch (error: unknown) {
      const err = error as Error;
      setMessage("Failed to update booking: " + err.message);
    }
  };

  const handleDeleteBooking = async (teamName: string, bookingIndex: number): Promise<void> => {
    if (!window.confirm("Are you sure you want to delete this booking?"))
      return;
    try {
      await deleteBooking(teamName, bookingIndex);
      setTeams((prev) =>
        prev.map((t) => (t.teamName === teamName ? { ...t, bookings: t.bookings.filter((_, i) => i !== bookingIndex) } : t))
      );
      setMessage("Booking deleted successfully");
    } catch (error: unknown) {
      const err = error as Error;
      setMessage("Failed to delete booking: " + err.message);
    }
  };

  const handleDeleteTeam = async (teamName: string): Promise<void> => {
    if (!window.confirm(`Are you sure you want to delete team "${teamName}" and all its bookings?`)) return;

    try {
      await deleteTeam(teamName);
      setTeams((prev) => prev.filter((t) => t.teamName !== teamName));
      setMessage(`Team "${teamName}" deleted successfully.`);
      setSelectedTeams((prev) => prev.filter((t) => t !== teamName));
    } catch (error: unknown) {
      const err = error as Error;
      setMessage("Failed to delete team: " + err.message);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const { name, value, type } = e.target;
    setBooking((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
    }));
  };

  const handleAddTeam = async (): Promise<void> => {
    if (!newTeamName.trim()) {
      setMessage("Team name cannot be empty.");
      return;
    }
    try {
      const res = await createTeam({
        teamName: newTeamName,
        bookings: [],
      });
      setTeams((prev) => [...prev, res]);
      setMessage(`Team "${res.teamName}" created.`);
      setNewTeamName("");
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setMessage(
        axiosError.response?.data?.message || "Error creating team. Try again."
      );
    }
  };

  const handleAddBooking = async (): Promise<void> => {
    if (selectedTeams.length === 0) {
      setMessage("Please select at least one team to add booking.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Each response carries only the new booking; append it locally instead of refetching all teams
      const results = await Promise.allSettled(
        selectedTeams.map(async (teamName) => ({ teamName, stored: await addBooking(teamName, booking) }))
      );
      const added = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      setTeams((prev) =>
        prev.map((t) => {
          const hit = added.find((a) => a.teamName === t.teamName);
          return hit ? { ...t, bookings: [...t.bookings, hit.stored] } : t;
        })
      );
      if (failed) throw failed.reason;
      setMessage("Booking added successfully to selected teams!");
      setBooking({
        customerName: "",
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
      });
      setSelectedTeams([]);
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
      const errMsg =
        axiosError.response?.data?.message ||
        axiosError.response?.data?.error ||
        axiosError.message ||
        "Unknown error";
      setMessage(`Error adding booking: ${errMsg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    handleAddBooking();
  };

  // Get current date in DD/MM/YYYY format
  const getCurrentDate = (): string => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-4"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-700 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Finance Tracker Pro</h1>
              <p className="text-gray-400 text-sm">Welcome, {user?.username || 'User'}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAll((prev) => !prev)}
              className="hidden md:flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-2 rounded-lg font-semibold shadow-lg hover:shadow-red-500/25 transition-all duration-300 border border-red-500"
            >
              {showAll ? (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                  Close Panel
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                  </svg>
                  Add Entry
                </>
              )}
            </motion.button>
            <Link
              to="/payments"
              className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 hover:text-white transition-all"
            >
              ← Payments
            </Link>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 hover:text-white transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
              </svg>
              <span className="hidden md:inline">Logout</span>
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Mobile Add Button */}
      <div className="md:hidden flex justify-center py-4">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowAll((prev) => !prev)}
          className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-3 rounded-lg font-semibold shadow-lg"
        >
          {showAll ? (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
              Close Panel
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
              </svg>
              Add Entry
            </>
          )}
        </motion.button>
      </div>

      <AnimatePresence>
        {showAll && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="px-4 md:px-8 py-6"
          >
            <div className="max-w-7xl mx-auto">
              {/* Message Display */}
              {message && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-6 p-4 rounded-lg text-white font-medium ${
                    message.includes("success") ? "bg-green-600/80" : "bg-red-600/80"
                  }`}
                >
                  {message}
                </motion.div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Add New Team */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white/5 backdrop-blur-md rounded-xl p-6 border border-gray-700/50"
                >
                  <h2 className="text-xl font-bold text-white mb-4 flex items-center">
                    <span className="w-2 h-6 bg-red-500 mr-3 rounded-full"></span>
                    Add New Team
                  </h2>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder="Enter team name or search..."
                      className="flex-1 bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      value={newTeamName}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        setNewTeamName(e.target.value);
                        setSearchTerm(e.target.value);
                      }}
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') {
                          handleAddTeam();
                        }
                      }}
                    />
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleAddTeam}
                      className="bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-red-700 hover:to-red-800 transition-all duration-300"
                    >
                      Add
                    </motion.button>
                  </div>
                </motion.div>

                {/* Select Teams */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-white/5 backdrop-blur-md rounded-xl p-6 border border-gray-700/50"
                >
                  <h2 className="text-xl font-bold text-white mb-4 flex items-center">
                    <span className="w-2 h-6 bg-red-500 mr-3 rounded-full"></span>
                    Select Teams for Booking
                  </h2>
                  {teams.length === 0 ? (
                    <p className="text-gray-400 text-center py-4">No teams available. Create a team first.</p>
                  ) : (
                    <>
                    {searchTerm && (
                      <p className="text-gray-400 text-sm mb-3">
                        Showing teams matching "{searchTerm}"
                      </p>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 overflow-y-auto max-h-64">
                      {teams
                        .filter(team => 
                          team.teamName.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .map(({ teamName, _id }) => (
                        <motion.div
                          key={_id}
                          whileHover={{ scale: 1.02 }}
                          onClick={() => handleCheckboxChange(teamName)}
                          className={`cursor-pointer rounded-lg p-3 border transition-all duration-300 ${
                            selectedTeams.includes(teamName)
                              ? 'bg-red-600/30 border-red-500'
                              : 'bg-black/30 border-gray-600 hover:border-gray-500'
                          }`}
                        >
                          <label className="flex items-center text-white font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              value={teamName}
                              checked={selectedTeams.includes(teamName)}
                              onChange={() => handleCheckboxChange(teamName)}
                              className="mr-2 w-4 h-4 text-red-600 bg-black border-red-500 rounded focus:ring-red-500"
                            />
                            <span className="text-sm truncate">{teamName}</span>
                          </label>
                        </motion.div>
                      ))}
                    </div>
                    {searchTerm && teams.filter(team => team.teamName.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                      <p className="text-gray-400 text-center py-3 text-sm">
                        No teams found matching "{searchTerm}". Press Add to create a new team.
                      </p>
                    )}
                    </>
                  )}
                </motion.div>
              </div>

              {/* Add Booking Form */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-6 bg-white/5 backdrop-blur-md rounded-xl p-6 border border-gray-700/50"
              >
                <h2 className="text-xl font-bold text-white mb-6 flex items-center">
                  <span className="w-2 h-6 bg-red-500 mr-3 rounded-full"></span>
                  Add Booking Entry
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Date</label>
                      <input
                        type="date"
                        name="date"
                        value={booking.date}
                        onChange={handleInputChange}
                        placeholder={getCurrentDate()}
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Time</label>
                      <input
                        type="text"
                        name="time"
                        value={booking.time}
                        onChange={handleInputChange}
                        placeholder="e.g., 8:00 PM"
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Server</label>
                      <input
                        type="text"
                        name="server"
                        value={booking.server}
                        onChange={handleInputChange}
                        placeholder="Server name"
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Entry Fee (Rs)</label>
                      <input
                        type="number"
                        name="entryFee"
                        value={booking.entryFee || ""}
                        onChange={handleInputChange}
                        placeholder="0"
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Winning (Rs)</label>
                      <input
                        type="number"
                        name="winning"
                        value={booking.winning || ""}
                        onChange={handleInputChange}
                        placeholder="0"
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Description</label>
                      <input
                        type="text"
                        name="discription"
                        value={booking.discription}
                        onChange={handleInputChange}
                        placeholder="Notes..."
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Booked By</label>
                      <input
                        type="text"
                        name="caster"
                        value={booking.caster}
                        onChange={handleInputChange}
                        placeholder="Your name"
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-sm mb-2">Win Given (Rs)</label>
                      <input
                        type="text"
                        name="production"
                        value={booking.production}
                        onChange={handleInputChange}
                        placeholder="0"
                        className="w-full bg-black/50 border-2 border-gray-600 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 transition-all duration-300 placeholder-gray-500"
                      />
                    </div>
                  </div>

                  {/* Selected Teams Display */}
                  {selectedTeams.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-600/20 border border-red-500/50 rounded-lg p-4"
                    >
                      <p className="text-white">
                        <span className="text-red-400 font-semibold">Selected Teams:</span>{" "}
                        {selectedTeams.join(", ")}
                      </p>
                    </motion.div>
                  )}

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="pt-4"
                  >
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={isSubmitting || selectedTeams.length === 0}
                      className={`w-full py-4 px-6 rounded-lg font-bold text-lg transition-all duration-300 ${
                        isSubmitting || selectedTeams.length === 0
                          ? "bg-gray-600 cursor-not-allowed text-gray-400"
                          : "bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-700 hover:to-red-800 shadow-lg hover:shadow-red-500/25"
                      }`}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center justify-center">
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </span>
                      ) : (
                        `Add Booking to ${selectedTeams.length} Team${selectedTeams.length !== 1 ? 's' : ''}`
                      )}
                    </motion.button>
                  </motion.div>
                </form>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Display Teams */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <Display
          teams={teams}
          onDeleteTeam={handleDeleteTeam}
          onUpdateBooking={handleUpdateBooking}
          onDeleteBooking={handleDeleteBooking}
        />
      </motion.div>
    </div>
  );
};

export default TeamSelector;