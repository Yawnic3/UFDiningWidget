export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public upstreamStatus?: number,
    public retryAt?: string,
  ) {
    super(message);
  }
}

export interface Period {
  id: string;
  name: string;
  start?: string;
  end?: string;
  isClosed?: boolean;
}

export interface Station {
  name: string;
  items: string[];
  start?: string;
  end?: string;
  isClosed?: boolean;
}

export interface Menu {
  date?: string;
  period: Period;
  stations: Station[];
}

export interface Periods {
  periods: Period[];
  menu?: Menu;
}

export const normalize = (value: string) => value.trim().toLowerCase();
