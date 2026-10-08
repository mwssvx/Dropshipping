import Constants from "expo-constants";

/** Where the platform runs. Set EXPO_PUBLIC_API_URL when building; app.json's extra.apiUrl is the fallback. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string | undefined) || "http://localhost:3000").replace(/\/$/, "");
export const BRAND = Constants.expoConfig?.name ?? "Storefront";
