import Constants from "expo-constants";

// Base URL of the StudySync backend. Defaults to the live Railway deployment; override via
// app.json -> expo.extra.apiBaseUrl (or an EXPO_PUBLIC_API_BASE_URL env var) for local dev.
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ||
  "https://studysync-production-1228.up.railway.app";
