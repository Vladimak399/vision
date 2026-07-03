export type UserRole = "admin" | "manager" | "reviewer";

export type Money = {
  amountMinor: number;
  currency: string;
};

export type AppStatus = "idle" | "loading" | "success" | "error";
