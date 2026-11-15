// Shapes of the OpenF1 rows this app reads. Deprecated fields (drivers.country_code,
// pit.pit_duration) are deliberately left out so they cannot be used.

export type Session = {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  circuit_key: number;
  circuit_short_name: string;
  country_name: string;
  location: string;
  gmt_offset: string;
  is_cancelled?: boolean;
  year: number;
};

export type Meeting = {
  meeting_key: number;
  meeting_name: string;
  circuit_key: number;
  circuit_short_name: string;
  circuit_type: string;
  circuit_info_url: string | null;
  gmt_offset: string;
  date_start: string;
  date_end?: string;
  is_cancelled?: boolean;
  year: number;
};

export type Driver = {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  team_name: string | null;
  team_colour: string | null;
};

export type Lap = {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean;
};

export type RaceControl = {
  date: string;
  category: string;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  driver_number: number | null;
  lap_number: number | null;
  qualifying_phase: number | null;
  message: string;
};

export type LocationRow = { date: string; driver_number: number; x: number; y: number; z: number };

export type CarDataRow = {
  date: string;
  driver_number: number;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
};

export type IntervalRow = {
  date: string;
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
};

export type PositionRow = { date: string; driver_number: number; position: number };

export type PitRow = { date: string; driver_number: number; lap_number: number; lane_duration: number | null };

export type SessionResult = {
  driver_number: number;
  position: number | null;
  dnf: boolean;
  dns: boolean;
  dsq: boolean;
  number_of_laps: number | null;
  duration: number | number[] | null;
  gap_to_leader: number | string | (number | string | null)[] | null;
};
