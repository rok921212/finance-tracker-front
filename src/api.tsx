import axios from "axios";

const API_BASE_URL = "https://finance-app-back-i6r7.onrender.com/api";

// Helper function to get auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Type definitions
export interface Booking {
  customerName?: string;
  date: string;
  time: string;
  server: string;
  entryFee: number;
  winning: number;
  discription: string;
  caster: string;
  casterCost: number;
  production: string;
  productionCost: number;
  paid?: boolean; // Entry fee paid status - default false (unpaid)
}

export interface Team {
  _id: string;
  teamName: string;
  bookings: Booking[];
}

export interface CreateTeamRequest {
  teamName: string;
  bookings: Booking[];
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

// API functions
export const fetchTeams = async (): Promise<Team[]> => {
  const response = await axios.get<Team[]>(`${API_BASE_URL}/bookingData`, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const createTeam = async (teamData: CreateTeamRequest): Promise<Team> => {
  const response = await axios.post<Team>(`${API_BASE_URL}/bookingData`, teamData, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const deleteTeam = async (teamName: string): Promise<void> => {
  const encodedName = encodeURIComponent(teamName);
  await axios.delete(`${API_BASE_URL}/bookingData/${encodedName}`, {
    headers: getAuthHeaders(),
  });
};

export const addBooking = async (teamName: string, booking: Booking): Promise<void> => {
  const encodedName = encodeURIComponent(teamName);
  await axios.post(`${API_BASE_URL}/bookingData/${encodedName}/bookings`, booking, {
    headers: getAuthHeaders(),
  });
};

export const updateBooking = async (
  teamName: string,
  bookingIndex: number,
  updatedBooking: Booking
): Promise<void> => {
  const encodedName = encodeURIComponent(teamName);
  await axios.put(
    `${API_BASE_URL}/bookingData/${encodedName}/bookings/${bookingIndex}`,
    updatedBooking,
    { headers: getAuthHeaders() }
  );
};

export const deleteBooking = async (
  teamName: string,
  bookingIndex: number
): Promise<void> => {
  const encodedName = encodeURIComponent(teamName);
  await axios.delete(`${API_BASE_URL}/bookingData/${encodedName}/bookings/${bookingIndex}`, {
    headers: getAuthHeaders(),
  });
};

// Export default object with all API methods
const api = {
  fetchTeams,
  createTeam,
  deleteTeam,
  addBooking,
  updateBooking,
  deleteBooking,
};

export default api;